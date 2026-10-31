function Get-CHSIOrganizationData {
    <#
    .SYNOPSIS
        Collects tenant identity: display name, tenant id, verified domains, country, logo.

    .DESCRIPTION
        Required. Without it the report has no subject, so a failure here is fatal rather
        than degraded.

        Scope: Organization.Read.All
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param()

    try {
        $response = Invoke-CHSIGraphRequest -Uri '/v1.0/organization'
        $org = @($response['value'])[0]

        if (-not $org) {
            return New-CHSICollectorResult -Name 'organization' -Available $false `
                -Reason 'Graph returned no organization object for this tenant.'
        }

        $verifiedDomains = @()
        if ($org.ContainsKey('verifiedDomains') -and $org['verifiedDomains']) {
            $verifiedDomains = @($org['verifiedDomains'] | ForEach-Object {
                    [pscustomobject]@{
                        Name      = $_['name']
                        IsDefault = [bool]$_['isDefault']
                        IsInitial = [bool]$_['isInitial']
                    }
                })
        }

        $notes = [System.Collections.Generic.List[string]]::new()
        $logo = Get-CHSITenantLogo -TenantId $org['id'] -Note $notes

        $data = [pscustomobject]@{
            TenantId        = $org['id']
            DisplayName     = $org['displayName']
            CountryLetterCode = if ($org.ContainsKey('countryLetterCode')) { $org['countryLetterCode'] } else { $null }
            CreatedDateTime = if ($org.ContainsKey('createdDateTime')) { $org['createdDateTime'] } else { $null }
            VerifiedDomains = $verifiedDomains
            DefaultDomain   = ($verifiedDomains | Where-Object IsDefault | Select-Object -First 1).Name
            Logo            = $logo
        }

        Write-CHSILog -Level Info -Source 'Collect' -Message "Organization: $($data.DisplayName) ($($data.DefaultDomain))"
        New-CHSICollectorResult -Name 'organization' -Data $data -Notes @($notes)
    }
    catch {
        New-CHSICollectorResult -Name 'organization' -Available $false `
            -Reason "Could not read /organization: $($_.Exception.Message)"
    }
}

function Get-CHSITenantLogo {
    <#
    .SYNOPSIS
        The square logo from the tenant's Entra company branding, light and dark.

    .DESCRIPTION
        Decoration, so it never costs the report anything: a tenant with no branding gets
        its initial instead, and a failure is noted rather than degrading the identity
        collector. Graph serves it under Organization.Read.All, which the tool already holds.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [string]$TenantId,

        [System.Collections.Generic.List[string]]$Note
    )

    if (-not $TenantId) { return $null }

    $found = @{}
    foreach ($name in 'squareLogo', 'squareLogoDark') {
        try {
            $found[$name] = Invoke-CHSIGraphRequest -Uri "/v1.0/organization/$TenantId/branding/localizations/default/$name" -AsImage
        }
        catch {
            $which = if ($name -eq 'squareLogo') { 'company' } else { 'dark-theme company' }
            if ($null -ne $Note) { $Note.Add("The $which logo was not read: $($_.Exception.Message)") }
            $found[$name] = $null
        }
    }

    if (-not $found['squareLogo'] -and -not $found['squareLogoDark']) { return $null }
    [pscustomobject]@{
        Light = $found['squareLogo']
        Dark  = $found['squareLogoDark']
    }
}
