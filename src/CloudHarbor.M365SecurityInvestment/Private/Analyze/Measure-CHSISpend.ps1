function Measure-CHSISpend {
    <#
    .SYNOPSIS
        Totals the licence inventory into the spend figures the report leads with.

    .DESCRIPTION
        Reports two different dollar totals on purpose, because they answer two different
        questions and conflating them is how these reports lose credibility with a CFO:

        * AnnualSpendConsumed  -- consumed seats x price. What the brief calls "current
          spend": the value actually in use.
        * AnnualCommitment     -- purchased seats x price. What most EA and CSP customers
          are actually invoiced for, whether or not the seats are assigned.

        The difference between them is category 1 of seat waste (unassigned purchased
        seats), and it is money that is already gone.

        SKUs with no known price are excluded from every dollar figure and counted
        separately, so the reader can see the totals are incomplete rather than assuming
        they are complete.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Inventory,

        [Parameter(Mandatory)]
        [hashtable]$Config,

        [object]$PriceList
    )

    if (-not $PriceList) { $PriceList = Get-CHSIDataFile -Name 'pricelist' }

    $billable = @($Inventory | Where-Object { -not $_.Excluded })
    $priced   = @($billable | Where-Object { $_.PriceKnown })
    $unpriced = @($billable | Where-Object { -not $_.PriceKnown })
    $excluded = @($Inventory | Where-Object { $_.Excluded })

    $sum = {
        param($collection, $property)
        $values = @($collection | ForEach-Object { $_.$property } | Where-Object { $null -ne $_ })
        if ($values.Count -eq 0) { return 0.0 }
        [double]($values | Measure-Object -Sum).Sum
    }

    $seatsPurchased = [int](& $sum $billable 'PurchasedUnits')
    $seatsConsumed  = [int](& $sum $billable 'ConsumedUnits')

    $annualConsumed   = & $sum $priced 'AnnualSpendConsumed'
    $annualCommitment = & $sum $priced 'AnnualCommitment'
    $unassignedCost   = & $sum $priced 'UnassignedSeatCost'
    $securityBudget   = & $sum $priced 'SecurityBudgetAnnual'

    $currency = $Config.pricing.currency
    $basis    = $Config.pricing.basis

    [pscustomobject]@{
        Currency               = $currency
        Basis                  = $basis
        BasisLabel             = Get-CHSIPricingBasisLabel -Basis $basis -PriceList $PriceList
        PricingAsOf            = $PriceList.asOf
        PricingVerified        = [bool]$PriceList.verified
        PricingWarning         = if (-not $PriceList.verified) { $PriceList.verificationWarning } else { $null }

        SeatsPurchased         = $seatsPurchased
        SeatsConsumed          = $seatsConsumed
        SeatsUnassigned        = [Math]::Max(0, $seatsPurchased - $seatsConsumed)

        AnnualSpendConsumed    = $annualConsumed
        MonthlySpendConsumed   = $annualConsumed / 12
        AnnualCommitment       = $annualCommitment
        UnassignedSeatCost     = $unassignedCost
        SecurityBudgetAnnual   = $securityBudget

        SkuCountTotal          = @($Inventory).Count
        SkuCountBillable       = $billable.Count
        SkuCountPriced         = $priced.Count
        SkuCountUnpriced       = $unpriced.Count
        SkuCountExcluded       = $excluded.Count
        UnpricedSkus           = @($unpriced | Select-Object SkuPartNumber, DisplayName, ConsumedUnits)
        ExcludedSkus           = @($excluded | Select-Object SkuPartNumber, DisplayName, ExclusionReason)

        Complete               = ($unpriced.Count -eq 0)
    }
}

function Get-CHSIPricingBasisLabel {
    <#
    .SYNOPSIS
        The human-readable pricing-basis sentence printed in the report header.
    .DESCRIPTION
        The brief is explicit that a CFO will ask which basis produced the numbers, so the
        answer is rendered prominently rather than buried in an appendix.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][string]$Basis,
        [Parameter(Mandatory)][object]$PriceList
    )

    switch ($Basis) {
        'CustomNegotiated' {
            "Customer-supplied negotiated rates$(if ($PriceList.asOf) { " (as of $($PriceList.asOf))" })"
        }
        default {
            $label = "Microsoft public list price$(if ($PriceList.asOf) { ", as of $($PriceList.asOf)" })"
            if (-not $PriceList.verified) { $label += ' -- unverified seed data' }
            $label
        }
    }
}

function Measure-CHSISpendRealization {
    <#
    .SYNOPSIS
        The board one-pager's headline metric: how much of the security value you bought
        is actually working for you.

    .DESCRIPTION
        Realization has two components:

        * Seat realization    -- of the seats you bought, how many are assigned to someone.
        * Feature realization -- of the security capabilities those seats entitle you to,
                                 how many are actually deployed and enforced.

        Milestone M1 measures only the first. The second requires the Secure Score
        control evidence that arrives in M3, so it is reported as not-yet-measured rather
        than assumed complete, and the composite figure is withheld until both halves
        exist. Showing a seat-only number labelled "spend realized" would overstate the
        tenant's position, which is the exact failure mode this tool exists to correct.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [object]$Spend
    )

    $seatRatio = ConvertTo-CHSISafeRatio $Spend.SeatsConsumed $Spend.SeatsPurchased

    [pscustomobject]@{
        Seat      = [pscustomobject]@{
            Available = $true
            Ratio     = $seatRatio
            Label     = 'Seat realization'
            Detail    = "$('{0:N0}' -f $Spend.SeatsConsumed) of $('{0:N0}' -f $Spend.SeatsPurchased) purchased seats are assigned."
        }
        Feature   = [pscustomobject]@{
            Available = $false
            Ratio     = $null
            Label     = 'Feature realization'
            Detail    = 'Not yet measured. Requires Secure Score control evidence (milestone M3).'
        }
        Composite = [pscustomobject]@{
            Available = $false
            Ratio     = $null
            Label     = 'Spend realized'
            Detail    = 'Withheld until both seat and feature realization are measured.'
        }
    }
}
