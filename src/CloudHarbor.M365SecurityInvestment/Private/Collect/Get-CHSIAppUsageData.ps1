function Get-CHSIAppUsageData {
    <#
    .SYNOPSIS
        Collects which platforms each account used the Microsoft 365 apps on, over 90 days.

    .DESCRIPTION
        The evidence for the over-provisioned waste category: an account licensed for the
        desktop apps that only ever used them on the web or on a phone.

        One read-only endpoint, /reports/getM365AppUserDetail, asked for JSON rather than
        the default CSV, whose redirect to a separate download host the browser tier could
        not follow. Only the 4 platform flags are kept. The report carries per-app columns
        and activity dates too, and none of them is needed.

        Gated twice, and both gates are optional. Reports.Read.All must be consented, and
        the person running the tool needs a reports role: Graph gives Global Reader tenant
        totals only, with no per-user rows. Reports Reader is the least-privileged role
        that sees them. Either gate failing degrades one waste category and nothing else.

        Microsoft hides names in usage reports by default, replacing each user principal
        name with an opaque value. That is recorded, not worked around: the analysis then
        counts accounts without naming them. This collector never asks for the setting to
        change, and reading it would need another permission.

        Scope: Reports.Read.All (least-privilege role: Reports Reader).
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param()

    $periodDays = 90

    try {
        $raw = Invoke-CHSIGraphRequest -Uri "/v1.0/reports/getM365AppUserDetail(period='D$periodDays')?`$format=application/json" -All
    }
    catch {
        $status = 0
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $null = [int]::TryParse($_.ErrorDetails.Message, [ref]$status) }

        $reason = if ($status -eq 403) {
            'Usage reports need Reports.Read.All and a reports role such as Reports Reader, and Graph refused the request. Over-provisioning is not measured; everything else in this report is unaffected.'
        }
        else {
            "Could not read the Microsoft 365 apps usage report: $($_.Exception.Message)"
        }
        return New-CHSICollectorResult -Name 'appUsage' -Available $false -Reason $reason
    }

    $rows = @($raw)
    if ($rows.Count -eq 0) {
        # Global Reader gets a successful, empty answer. Taking that as "nobody used the
        # desktop apps" would flag every licensed account in the tenant.
        return New-CHSICollectorResult -Name 'appUsage' -Available $false `
            -Reason 'The Microsoft 365 apps usage report returned no per-user rows. Global Reader sees only tenant totals in usage reports; Reports Reader sees each account. Over-provisioning is not measured.'
    }

    $users = foreach ($row in $rows) {
        $detail = @($row['details']) | Select-Object -First 1
        [pscustomobject]@{
            UserPrincipalName = [string]$row['userPrincipalName']
            Windows           = [bool]($detail -and $detail['windows'])
            Mac               = [bool]($detail -and $detail['mac'])
            Mobile            = [bool]($detail -and $detail['mobile'])
            Web               = [bool]($detail -and $detail['web'])
        }
    }

    # A concealed report replaces every name, so no row carries an @.
    $concealed = -not ($users | Where-Object { $_.UserPrincipalName -like '*@*' })

    $data = [pscustomobject]@{
        PeriodDays        = $periodDays
        ReportRefreshDate = $rows[0]['reportRefreshDate']
        Concealed         = $concealed
        Users             = @($users)
    }

    New-CHSICollectorResult -Name 'appUsage' -Available $true -Data $data
}
