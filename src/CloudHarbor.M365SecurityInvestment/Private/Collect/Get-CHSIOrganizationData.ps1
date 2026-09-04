function Get-CHSIOrganizationData {
    <#
    .SYNOPSIS
        Collects tenant identity: display name, tenant id, verified domains, country.

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

        $data = [pscustomobject]@{
            TenantId        = $org['id']
            DisplayName     = $org['displayName']
            CountryLetterCode = if ($org.ContainsKey('countryLetterCode')) { $org['countryLetterCode'] } else { $null }
            CreatedDateTime = if ($org.ContainsKey('createdDateTime')) { $org['createdDateTime'] } else { $null }
            VerifiedDomains = $verifiedDomains
            DefaultDomain   = ($verifiedDomains | Where-Object IsDefault | Select-Object -First 1).Name
        }

        Write-CHSILog -Level Info -Source 'Collect' -Message "Organization: $($data.DisplayName) ($($data.DefaultDomain))"
        New-CHSICollectorResult -Name 'organization' -Data $data
    }
    catch {
        New-CHSICollectorResult -Name 'organization' -Available $false `
            -Reason "Could not read /organization: $($_.Exception.Message)"
    }
}
