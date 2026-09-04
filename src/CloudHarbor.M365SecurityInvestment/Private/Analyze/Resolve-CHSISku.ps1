function Resolve-CHSISku {
    <#
    .SYNOPSIS
        Turns raw subscribedSkus payloads into the priced, named licence inventory the
        rest of the report is built on.

    .DESCRIPTION
        Three jobs:

        1. Resolve skuPartNumber to a friendly product name via the shipped catalog.
           Microsoft's part numbers routinely disagree with the marketing name
           (O365_BUSINESS_PREMIUM is Business *Standard*), so unresolved part numbers are
           surfaced rather than guessed at.

        2. Attach a price. A SKU with no price entry is marked PriceKnown = $false and is
           excluded from dollar totals but still counted in seat totals -- never silently
           priced at zero.

        3. Flag free and self-service SKUs. These report implausible "unlimited" seat
           counts (commonly 10,000 or 1,000,000) that would otherwise dominate every
           total in the report.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Sku,

        [Parameter(Mandatory)]
        [hashtable]$Config,

        [object]$PriceList
    )

    $catalog   = Get-CHSIDataFile -Name 'sku-catalog'
    if (-not $PriceList) { $PriceList = Get-CHSIDataFile -Name 'pricelist' }

    $catalogIndex = @{}
    foreach ($entry in $catalog.skus) { $catalogIndex[$entry.skuPartNumber] = $entry }

    $priceIndex = @{}
    foreach ($entry in $PriceList.prices) { $priceIndex[$entry.skuPartNumber] = $entry }

    $unlimitedThreshold    = [int]$Config.skus.unlimitedSeatThreshold
    $unrecognizedThreshold = [int]$Config.skus.unrecognizedSeatThreshold
    $manualExclusions      = @($Config.skus.excludeSkuPartNumbers)
    $defaultShare       = if ($PriceList.PSObject.Properties['defaultSecurityValueShare']) { [double]$PriceList.defaultSecurityValueShare } else { 0.10 }

    foreach ($item in $Sku) {
        $partNumber = $item.SkuPartNumber
        $catalogEntry = $catalogIndex[$partNumber]
        $priceEntry   = $priceIndex[$partNumber]

        $purchased = [int]$item.PrepaidEnabled
        $consumed  = [int]$item.ConsumedUnits

        # --- Exclusion decisions, in priority order -------------------------------
        $isCatalogFree = [bool]($catalogEntry -and $catalogEntry.PSObject.Properties['isFree'] -and $catalogEntry.isFree)
        $isUnlimited   = $purchased -ge $unlimitedThreshold
        $isManuallyExcluded = $manualExclusions -contains $partNumber
        $isUnrecognizedViral = (-not $catalogEntry) -and (-not $priceEntry) -and ($purchased -ge $unrecognizedThreshold)

        $excluded = $false
        $exclusionReason = $null

        if ($isManuallyExcluded) {
            $excluded = $true
            $exclusionReason = 'Excluded by configuration.'
        }
        elseif ($isCatalogFree) {
            $excluded = $true
            $exclusionReason = 'Free or self-service SKU; carries no cost and reports an unlimited seat count.'
        }
        elseif ($isUnlimited) {
            $excluded = $true
            $exclusionReason = "Reports $('{0:N0}' -f $purchased) purchased seats, at or above the $('{0:N0}' -f $unlimitedThreshold) unlimited-seat threshold. Treated as an unlimited free SKU."
        }
        elseif ($isUnrecognizedViral) {
            # 10,000 seats is a plausible enterprise purchase on its own, so this branch
            # also requires that the SKU is unknown to the catalog and unpriced. Left in,
            # a viral trial injects five figures of phantom seats into seat realization.
            $excluded = $true
            $exclusionReason = "Reports $('{0:N0}' -f $purchased) purchased seats but is absent from the SKU catalog and has no price. Treated as a self-service or viral trial rather than a purchase; add it to the catalog and price list if this tenant genuinely bought it."
        }

        # --- Pricing ---------------------------------------------------------------
        $priceKnown = [bool]$priceEntry
        $monthly    = if ($priceKnown) { [double]$priceEntry.monthlyPerSeat } else { $null }
        $annual     = if ($null -ne $monthly) { $monthly * 12 } else { $null }

        $share = if ($priceKnown -and $priceEntry.PSObject.Properties['securityValueShare']) {
            [double]$priceEntry.securityValueShare
        }
        else {
            $defaultShare
        }

        $countsTowardMoney = (-not $excluded) -and $priceKnown

        if (-not $excluded -and -not $priceKnown) {
            Write-CHSILog -Level Warning -Source 'Analyze' -Message "No price entry for SKU '$partNumber'. It is counted in seat totals but excluded from every dollar figure."
        }

        [pscustomobject]@{
            SkuId                 = $item.SkuId
            SkuPartNumber         = $partNumber
            DisplayName           = if ($catalogEntry) { $catalogEntry.displayName } else { $partNumber }
            Family                = if ($catalogEntry) { $catalogEntry.family } else { 'Unrecognized' }
            NamingTrap            = if ($catalogEntry -and $catalogEntry.PSObject.Properties['trap']) { $catalogEntry.trap } else { $null }
            InCatalog             = [bool]$catalogEntry

            PurchasedUnits        = $purchased
            ConsumedUnits         = $consumed
            UnassignedUnits       = [Math]::Max(0, $purchased - $consumed)
            SuspendedUnits        = [int]$item.PrepaidSuspended
            WarningUnits          = [int]$item.PrepaidWarning
            CapabilityStatus      = $item.CapabilityStatus

            IsFreeSku             = $isCatalogFree
            # True when the reported seat count is not credible as a purchase, by either
            # heuristic.
            IsUnlimitedSeatCount  = ($isUnlimited -or $isUnrecognizedViral)
            Excluded              = $excluded
            ExclusionReason       = $exclusionReason

            PriceKnown            = $priceKnown
            UnitPriceMonthly      = $monthly
            UnitPriceAnnual       = $annual
            SecurityValueShare    = $share

            AnnualSpendConsumed   = if ($countsTowardMoney) { $annual * $consumed } else { $null }
            AnnualCommitment      = if ($countsTowardMoney) { $annual * $purchased } else { $null }
            UnassignedSeatCost    = if ($countsTowardMoney) { $annual * [Math]::Max(0, $purchased - $consumed) } else { $null }
            SecurityBudgetAnnual  = if ($countsTowardMoney) { $annual * $consumed * $share } else { $null }

            SeatUtilization       = ConvertTo-CHSISafeRatio $consumed $purchased
            ServicePlans          = @($item.ServicePlans)
        }
    }
}
