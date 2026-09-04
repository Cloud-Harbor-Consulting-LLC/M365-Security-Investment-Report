function ConvertTo-CHSIJson {
    <#
    .SYNOPSIS
        Serializes the full report model as JSON.
    .DESCRIPTION
        The JSON export is the same dataset the HTML renders, not a summary of it, so
        finance and automation consumers never have to scrape the report.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [object]$Report
    )

    $Report | ConvertTo-Json -Depth 12
}

function ConvertTo-CHSIInventoryCsvRow {
    <#
    .SYNOPSIS
        Flattens the licence inventory into rows suitable for CSV and for a spreadsheet
        pivot. Nested service plans are dropped here and remain available in the JSON.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [object]$Report
    )

    foreach ($item in $Report.Inventory) {
        [pscustomobject]@{
            TenantId             = $Report.Tenant.TenantId
            TenantName           = $Report.Tenant.DisplayName
            GeneratedAtUtc       = ([datetime]$Report.GeneratedAt).ToString('o')
            Currency             = $Report.Spend.Currency
            PricingBasis         = $Report.Spend.BasisLabel
            SkuPartNumber        = $item.SkuPartNumber
            ProductName          = $item.DisplayName
            Family               = $item.Family
            SkuId                = $item.SkuId
            PurchasedSeats       = $item.PurchasedUnits
            AssignedSeats        = $item.ConsumedUnits
            UnassignedSeats      = $item.UnassignedUnits
            SeatUtilization      = if ($null -eq $item.SeatUtilization) { '' } else { [Math]::Round($item.SeatUtilization, 4) }
            UnitPriceMonthly     = $item.UnitPriceMonthly
            UnitPriceAnnual      = $item.UnitPriceAnnual
            AnnualCommitment     = $item.AnnualCommitment
            AnnualSpendAssigned  = $item.AnnualSpendConsumed
            IdleSeatCost         = $item.UnassignedSeatCost
            SecurityValueShare   = $item.SecurityValueShare
            SecurityBudgetAnnual = $item.SecurityBudgetAnnual
            PriceKnown           = $item.PriceKnown
            Excluded             = $item.Excluded
            ExclusionReason      = $item.ExclusionReason
            NamingTrap           = $item.NamingTrap
        }
    }
}

function ConvertTo-CHSISummaryCsvRow {
    <#
    .SYNOPSIS
        A single-row tenant summary, for appending across engagements in a spreadsheet.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [object]$Report
    )

    [pscustomobject]@{
        TenantId               = $Report.Tenant.TenantId
        TenantName             = $Report.Tenant.DisplayName
        DefaultDomain          = $Report.Tenant.DefaultDomain
        GeneratedAtUtc         = ([datetime]$Report.GeneratedAt).ToString('o')
        ToolVersion            = $Report.Tool.Version
        Currency               = $Report.Spend.Currency
        PricingBasis           = $Report.Spend.BasisLabel
        PricingVerified        = $Report.Spend.PricingVerified
        SeatsPurchased         = $Report.Spend.SeatsPurchased
        SeatsAssigned          = $Report.Spend.SeatsConsumed
        SeatsUnassigned        = $Report.Spend.SeatsUnassigned
        SeatRealization        = if ($null -eq $Report.Realization.Seat.Ratio) { '' } else { [Math]::Round($Report.Realization.Seat.Ratio, 4) }
        AnnualCommitment       = $Report.Spend.AnnualCommitment
        AnnualSpendAssigned    = $Report.Spend.AnnualSpendConsumed
        IdleSeatCost           = $Report.Spend.UnassignedSeatCost
        SecurityBudgetAnnual   = $Report.Spend.SecurityBudgetAnnual
        SkusTotal              = $Report.Spend.SkuCountTotal
        SkusPriced             = $Report.Spend.SkuCountPriced
        SkusUnpriced           = $Report.Spend.SkuCountUnpriced
        SkusExcluded           = $Report.Spend.SkuCountExcluded
        DollarFiguresComplete  = $Report.Spend.Complete
    }
}
