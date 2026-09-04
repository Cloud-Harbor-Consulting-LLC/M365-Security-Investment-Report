function Get-CHSISkuData {
    <#
    .SYNOPSIS
        Collects every subscribed SKU on the tenant: purchased vs. consumed units and the
        service plans each SKU carries.

    .DESCRIPTION
        This is the spine of the entire report -- licence inventory, spend, seat waste and
        feature entitlement all derive from it. A failure here is fatal.

        Service plans are retained in full because milestone M3 maps security-bearing
        service plans to the Secure Score controls that prove deployment.

        Scope: Organization.Read.All
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param()

    try {
        $skus = Invoke-CHSIGraphRequest -Uri '/v1.0/subscribedSkus' -All

        $data = foreach ($sku in $skus) {
            $prepaid = if ($sku.ContainsKey('prepaidUnits') -and $sku['prepaidUnits']) { $sku['prepaidUnits'] } else { @{} }

            $servicePlans = @()
            if ($sku.ContainsKey('servicePlans') -and $sku['servicePlans']) {
                $servicePlans = @($sku['servicePlans'] | ForEach-Object {
                        [pscustomobject]@{
                            ServicePlanId      = $_['servicePlanId']
                            ServicePlanName    = $_['servicePlanName']
                            ProvisioningStatus = $_['provisioningStatus']
                            AppliesTo          = $_['appliesTo']
                        }
                    })
            }

            [pscustomobject]@{
                SkuId          = $sku['skuId']
                SkuPartNumber  = $sku['skuPartNumber']
                AppliesTo      = if ($sku.ContainsKey('appliesTo')) { $sku['appliesTo'] } else { $null }
                CapabilityStatus = if ($sku.ContainsKey('capabilityStatus')) { $sku['capabilityStatus'] } else { $null }
                ConsumedUnits  = [int]($sku['consumedUnits'] ?? 0)
                PrepaidEnabled = [int](($prepaid['enabled'] ?? 0))
                PrepaidSuspended = [int](($prepaid['suspended'] ?? 0))
                PrepaidWarning = [int](($prepaid['warning'] ?? 0))
                ServicePlans   = $servicePlans
            }
        }

        $data = @($data)
        Write-CHSILog -Level Info -Source 'Collect' -Message "Subscribed SKUs: $($data.Count) found."
        New-CHSICollectorResult -Name 'subscribedSkus' -Data $data
    }
    catch {
        New-CHSICollectorResult -Name 'subscribedSkus' -Available $false `
            -Reason "Could not read /subscribedSkus: $($_.Exception.Message)"
    }
}
