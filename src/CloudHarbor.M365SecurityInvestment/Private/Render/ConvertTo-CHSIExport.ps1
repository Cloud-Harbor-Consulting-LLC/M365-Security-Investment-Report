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

function ConvertTo-CHSICent {
    <#
    .SYNOPSIS
        Money to the cent for a CSV cell, or $null when the figure is unknown.
    .DESCRIPTION
        Mirrors cents() in app/src/engine/export.ts. The model keeps full precision so the
        2 tiers agree, and ConvertTo-Csv writes a double at full round-trip precision, so
        8.55 x 12 reached the sheet as 102.60000000000001. The JSON export is left whole.

        Away from zero, because .NET rounds a tie to even by default while JavaScript's
        Math.round rounds it up. For the non-negative money in these sheets the two agree.
    #>
    [CmdletBinding()]
    [OutputType([double])]
    param(
        [Parameter(Position = 0)]
        [AllowNull()]
        [object]$Value
    )

    if ($null -eq $Value) { return $null }
    [Math]::Round([double]$Value, 2, [MidpointRounding]::AwayFromZero)
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
            UnitPriceMonthly     = ConvertTo-CHSICent $item.UnitPriceMonthly
            UnitPriceAnnual      = ConvertTo-CHSICent $item.UnitPriceAnnual
            AnnualCommitment     = ConvertTo-CHSICent $item.AnnualCommitment
            AnnualSpendAssigned  = ConvertTo-CHSICent $item.AnnualSpendConsumed
            IdleSeatCost         = ConvertTo-CHSICent $item.UnassignedSeatCost
            SecurityValueShare   = $item.SecurityValueShare
            SecurityBudgetAnnual = ConvertTo-CHSICent $item.SecurityBudgetAnnual
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
        AnnualCommitment       = ConvertTo-CHSICent $Report.Spend.AnnualCommitment
        AnnualSpendAssigned    = ConvertTo-CHSICent $Report.Spend.AnnualSpendConsumed
        IdleSeatCost           = ConvertTo-CHSICent $Report.Spend.UnassignedSeatCost
        SecurityBudgetAnnual   = ConvertTo-CHSICent $Report.Spend.SecurityBudgetAnnual
        SkusTotal              = $Report.Spend.SkuCountTotal
        SkusPriced             = $Report.Spend.SkuCountPriced
        SkusUnpriced           = $Report.Spend.SkuCountUnpriced
        SkusExcluded           = $Report.Spend.SkuCountExcluded
        DollarFiguresComplete  = $Report.Spend.Complete
    }
}
