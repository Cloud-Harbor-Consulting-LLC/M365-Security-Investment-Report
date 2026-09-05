function Get-CHSIUserData {
    <#
    .SYNOPSIS
        Collects per-user account state and licence assignment, with sign-in activity
        where the tenant is entitled to it.

    .DESCRIPTION
        The basis for four of the five seat-waste categories: disabled but licensed,
        never signed in, inactive beyond a threshold, and over-provisioned.

        The awkward part, and the reason this function exists rather than a one-line
        call: `signInActivity` is gated on Entra ID P1, and Graph does not merely omit
        the field on a tenant without it -- it returns 403 for the ENTIRE query. Asking
        for it optimistically and failing would cost the disabled-but-licensed analysis
        too, which needs no premium licence at all.

        So the query is attempted with sign-in activity, and on 403 the identical query
        is retried without it. The result is marked degraded and the sign-in-dependent
        categories report as not measured, rather than silently reading as zero waste.

        Scopes: User.Read.All, plus AuditLog.Read.All for sign-in activity.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param()

    $baseSelect = 'id,displayName,userPrincipalName,accountEnabled,userType,createdDateTime,assignedLicenses,department'
    $withActivity = "$baseSelect,signInActivity"

    $uri = "/v1.0/users?`$select=$withActivity&`$top=999"
    $degraded = $false
    $reason = $null
    $raw = $null

    try {
        $raw = Invoke-CHSIGraphRequest -Uri $uri -All
    }
    catch {
        $status = 0
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $null = [int]::TryParse($_.ErrorDetails.Message, [ref]$status) }

        # 403 here almost always means the tenant lacks Entra ID P1 rather than that the
        # scope is missing; either way the remedy is the same, so retry without the field.
        if ($status -ne 403) {
            return New-CHSICollectorResult -Name 'users' -Available $false `
                -Reason "Could not read /users: $($_.Exception.Message)"
        }

        Write-CHSILog -Level Warning -Source 'Collect' -Message 'Sign-in activity was refused (403). Retrying without it; the never-signed-in and inactive analyses will report as not measured.'
        $degraded = $true
        $reason = 'Sign-in activity requires Entra ID P1 and AuditLog.Read.All. Graph returned 403 for the whole query, so it was re-run without that field. Account state and licence assignment are complete; the never-signed-in and inactive categories are not measured.'

        try {
            $raw = Invoke-CHSIGraphRequest -Uri "/v1.0/users?`$select=$baseSelect&`$top=999" -All
        }
        catch {
            return New-CHSICollectorResult -Name 'users' -Available $false `
                -Reason "Could not read /users even without sign-in activity: $($_.Exception.Message)"
        }
    }

    $data = foreach ($user in @($raw)) {
        $activity = if ($user.ContainsKey('signInActivity') -and $user['signInActivity']) { $user['signInActivity'] } else { $null }

        [pscustomobject]@{
            Id                = $user['id']
            DisplayName       = $user['displayName']
            UserPrincipalName = $user['userPrincipalName']
            AccountEnabled    = [bool]$user['accountEnabled']
            UserType          = if ($user.ContainsKey('userType')) { $user['userType'] } else { $null }
            CreatedDateTime   = if ($user.ContainsKey('createdDateTime')) { $user['createdDateTime'] } else { $null }
            Department        = if ($user.ContainsKey('department')) { $user['department'] } else { $null }
            AssignedSkuIds    = @(
                if ($user.ContainsKey('assignedLicenses') -and $user['assignedLicenses']) {
                    $user['assignedLicenses'] | ForEach-Object { $_['skuId'] }
                }
            )
            LastSignIn        = if ($activity) { $activity['lastSignInDateTime'] } else { $null }
            LastNonInteractiveSignIn = if ($activity) { $activity['lastNonInteractiveSignInDateTime'] } else { $null }
        }
    }

    $data = @($data)
    Write-CHSILog -Level Info -Source 'Collect' -Message "Users: $($data.Count) found$(if ($degraded) { ' (without sign-in activity)' })."

    New-CHSICollectorResult -Name 'users' -Data $data -Degraded $degraded -Reason $reason `
        -Notes @(if ($degraded) { 'signInActivity omitted' })
}
