function ConvertTo-CHSIHtml {
    <#
    .SYNOPSIS
        Renders the report model as a single self-contained HTML document.

    .DESCRIPTION
        Everything is inlined: stylesheet, fonts and charts. The finished
        file references no external host, so it renders offline and survives being
        forwarded as an email attachment -- which is how a board pack actually travels.

        Three layers in one document, per the brief: a board one-pager, an executive
        summary, and an architect appendix.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [object]$Report
    )

    $css = Get-CHSIEmbeddedAsset -RelativePath 'report.css' -As Raw
    $css = $css.Replace('__LATO_REGULAR__', (Get-CHSIEmbeddedAsset -RelativePath 'Fonts/Lato-Regular.ttf'))
    $css = $css.Replace('__LATO_BOLD__',    (Get-CHSIEmbeddedAsset -RelativePath 'Fonts/Lato-Bold.ttf'))

    $tenantName = if ($Report.Tenant.DisplayName) { $Report.Tenant.DisplayName } else { 'Unknown tenant' }
    $title = "Microsoft 365 Security Investment Report - $tenantName"

    $body = [System.Collections.Generic.List[string]]::new()
    $body.Add((Get-CHSIHtmlMasthead -Report $Report))
    $body.Add('<div class="ch-page">')
    $body.Add((Get-CHSIHtmlBoardLayer -Report $Report))
    $body.Add((Get-CHSIHtmlExecutiveLayer -Report $Report))
    if ($Report.Config.report.includeArchitectAppendix) {
        $body.Add((Get-CHSIHtmlArchitectLayer -Report $Report))
    }
    $body.Add((Get-CHSIHtmlFooter -Report $Report))
    $body.Add('</div>')

    @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="CloudHarbor.M365SecurityInvestment $($Report.Tool.Version)">
<title>$(ConvertTo-CHSIHtmlEncoded $title)</title>
<style>
$css
</style>
</head>
<body>
$($body -join "`n")
</body>
</html>
"@
}

function Get-CHSIHtmlMasthead {
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)][object]$Report)

    $generated = ([datetime]$Report.GeneratedAt).ToString('dd MMMM yyyy, HH:mm')
    $preparedFor = if ($Report.Config.report.preparedFor) { $Report.Config.report.preparedFor } else { $Report.Tenant.DisplayName }
    $preparedBy = $Report.Config.report.preparedBy

    @"
<header class="ch-masthead">
  <div class="ch-masthead-inner">
    <div>
      <h1>Microsoft 365 Security Investment Report</h1>
      <p class="ch-subject">$(ConvertTo-CHSIHtmlEncoded $Report.Tenant.DisplayName)$(if ($Report.Tenant.DefaultDomain) { ' &middot; ' + (ConvertTo-CHSIHtmlEncoded $Report.Tenant.DefaultDomain) })</p>
    </div>
    <div class="ch-masthead-meta">
      <div>Prepared for <strong>$(ConvertTo-CHSIHtmlEncoded $preparedFor)</strong></div>
      $(if ($preparedBy) { "<div>Prepared by <strong>$(ConvertTo-CHSIHtmlEncoded $preparedBy)</strong></div>" })
      <div>$generated UTC</div>
      <div>Pricing basis: <strong>$(ConvertTo-CHSIHtmlEncoded $Report.Spend.BasisLabel)</strong></div>
    </div>
  </div>
</header>
"@
}

function Get-CHSIHtmlBoardLayer {
    <#
    .SYNOPSIS
        Layer 1: the one-pager a board member reads and nothing else.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)][object]$Report)

    $currency = $Report.Spend.Currency
    $spend = $Report.Spend
    $realization = $Report.Realization

    # Branch on seat facts, never on dollar figures. An unpriced tenant has an idle cost of
    # $null, and treating that as "no idle seats" once produced the sentence "carries $0 a
    # year ... with every purchased seat assigned" for a tenant with 26 of 27 seats idle.
    $idleShare = if ($spend.AnyPriced) {
        ConvertTo-CHSISafeRatio $spend.UnassignedSeatCost $spend.AnnualCommitment
    }
    else { $null }

    $seatSentence = if ($spend.SeatsUnassigned -gt 0) {
        "<strong>$('{0:N0}' -f $spend.SeatsUnassigned)</strong> of its $('{0:N0}' -f $spend.SeatsPurchased) purchased seats are not assigned to anyone."
    }
    elseif ($spend.SeatsPurchased -gt 0) {
        "All $('{0:N0}' -f $spend.SeatsPurchased) of its purchased seats are assigned."
    }
    else {
        'No purchased seats were found.'
    }

    $lede = if (-not $spend.AnyPriced) {
        # No SKU on this tenant could be priced, so there is no spend figure to lead with.
        # Saying so is the honest headline; "$0" would not be.
        "None of this tenant's $($spend.SkuCountTotal) subscribed SKUs could be priced, so no spend figure can be produced yet. $seatSentence"
    }
    elseif ($spend.SeatsUnassigned -gt 0) {
        "This tenant carries <strong>$(Format-CHSICurrency $spend.AnnualCommitment -Currency $currency)</strong> a year in Microsoft 365 licence commitment. <strong>$(Format-CHSICurrency $spend.UnassignedSeatCost -Currency $currency)</strong> of that$(if ($null -ne $idleShare) { " &mdash; $(Format-CHSIPercent $idleShare) of the total" }) is paying for seats that are not assigned to anyone."
    }
    else {
        "This tenant carries <strong>$(Format-CHSICurrency $spend.AnnualCommitment -Currency $currency)</strong> a year in Microsoft 365 licence commitment, with every purchased seat assigned."
    }

    $unpricedBanner = if (-not $spend.AnyPriced) {
        $names = ($spend.UnpricedSkus | ForEach-Object { "<li><code>$(ConvertTo-CHSIHtmlEncoded $_.SkuPartNumber)</code> &mdash; $('{0:N0}' -f $_.ConsumedUnits) assigned seats</li>" }) -join "`n"
        @"
  <div class="ch-note ch-note--warning">
    <strong>No spend figures in this report</strong>
    Not one subscribed SKU on this tenant matched an entry in the price table, so every monetary figure below reads "not available" rather than zero. Add these part numbers to the price list to produce a spend analysis:
    <ul>
$names
    </ul>
  </div>
"@
    }
    else { '' }

    $moneyTileClass = if ($spend.AnyPriced) { 'ch-tile' } else { 'ch-tile ch-tile--muted' }
    $idleTileClass  = if ($spend.AnyPriced) { 'ch-tile ch-tile--attention' } else { 'ch-tile ch-tile--muted' }
    $moneyValueClass = if ($spend.AnyPriced) { 'ch-tile-value' } else { 'ch-tile-value ch-tile-value--unavailable' }

    $gauge = New-CHSIGaugeSvg -Ratio $realization.Seat.Ratio -Label 'of seats assigned'

    @"
<section class="ch-layer">
  <div class="ch-layer-head">
    <h2>Board one-pager</h2>
    <span class="ch-audience">Board &middot; CFO</span>
  </div>

  <p class="ch-lede">$lede</p>

$unpricedBanner

  <div class="ch-tiles">
    <div class="$moneyTileClass">
      <div class="ch-tile-label">Annual licence commitment</div>
      <div class="$moneyValueClass">$(if ($spend.AnyPriced) { Format-CHSICurrency $spend.AnnualCommitment -Currency $currency } else { 'Not available' })</div>
      <div class="ch-tile-note">$('{0:N0}' -f $spend.SeatsPurchased) purchased seats</div>
    </div>
    <div class="$moneyTileClass">
      <div class="ch-tile-label">Spend in use</div>
      <div class="$moneyValueClass">$(if ($spend.AnyPriced) { Format-CHSICurrency $spend.AnnualSpendConsumed -Currency $currency } else { 'Not available' })</div>
      <div class="ch-tile-note">$('{0:N0}' -f $spend.SeatsConsumed) assigned seats</div>
    </div>
    <div class="$idleTileClass">
      <div class="ch-tile-label">Idle seat spend</div>
      <div class="$moneyValueClass">$(if ($spend.AnyPriced) { Format-CHSICurrency $spend.UnassignedSeatCost -Currency $currency } else { 'Not available' })</div>
      <div class="ch-tile-note">$('{0:N0}' -f $spend.SeatsUnassigned) unassigned seats</div>
    </div>
    <div class="ch-tile ch-tile--muted">
      <div class="ch-tile-label">$(ConvertTo-CHSIHtmlEncoded $realization.Composite.Label)</div>
      <div class="ch-tile-value ch-tile-value--unavailable">Not yet measured</div>
      <div class="ch-tile-note">$(ConvertTo-CHSIHtmlEncoded $realization.Composite.Detail)</div>
    </div>
  </div>

  <h3>Seat realization</h3>
  <div class="ch-gauge-row">
    $gauge
    <div class="ch-gauge-caption">
      <p>$(ConvertTo-CHSIHtmlEncoded $realization.Seat.Detail)</p>
      <p>Seat realization answers only the first half of the spend question: whether the licences you bought are in someone's hands. It does not yet say whether the security capabilities those licences carry are switched on.</p>
    </div>
  </div>

  <div class="ch-note ch-note--pending">
    <strong>Feature realization is not in this build</strong>
    The second half of spend realization &mdash; how many of the security controls these licences entitle you to are actually deployed and enforced &mdash; requires Secure Score control evidence, which arrives in milestone M3. It is shown as not measured rather than assumed complete, because reporting a seat-only figure as "spend realized" would overstate this tenant's position.
  </div>
</section>
"@
}

function Get-CHSIHtmlExecutiveLayer {
    <#
    .SYNOPSIS
        Layer 2: where the spend actually sits, and on what basis it was calculated.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)][object]$Report)

    $currency = $Report.Spend.Currency
    $spend = $Report.Spend

    $chartItems = @(
        $Report.Inventory |
            Where-Object { -not $_.Excluded -and $_.PriceKnown -and $_.AnnualCommitment -gt 0 } |
            Sort-Object -Property AnnualCommitment -Descending |
            Select-Object -First 12 |
            ForEach-Object {
                [pscustomobject]@{
                    Label     = $_.DisplayName
                    Value     = $_.AnnualCommitment
                    ValueText = Format-CHSICurrency $_.AnnualCommitment -Currency $currency
                }
            }
    )

    $chart = if ($chartItems.Count -gt 0) {
        New-CHSIHorizontalBarSvg -Item $chartItems
    }
    else {
        '<p class="ch-empty">No priced SKUs to chart.</p>'
    }

    $pricingNote = if (-not $spend.PricingVerified) {
        @"
  <div class="ch-note ch-note--warning">
    <strong>Pricing basis: unverified seed data</strong>
    $(ConvertTo-CHSIHtmlEncoded $spend.PricingWarning)
  </div>
"@
    }
    else {
        @"
  <div class="ch-note">
    <strong>Pricing basis</strong>
    $(ConvertTo-CHSIHtmlEncoded $spend.BasisLabel). Microsoft Graph does not expose contract pricing; every dollar figure in this report comes from the price table supplied to the tool.
  </div>
"@
    }

    $unpricedNote = if ($spend.SkuCountUnpriced -gt 0) {
        $names = ($spend.UnpricedSkus | ForEach-Object { "<li>$(ConvertTo-CHSIHtmlEncoded $_.DisplayName) &mdash; $('{0:N0}' -f $_.ConsumedUnits) assigned seats</li>" }) -join "`n"
        @"
  <div class="ch-note ch-note--warning">
    <strong>$($spend.SkuCountUnpriced) SKU(s) have no price and are excluded from every dollar figure above</strong>
    These seats are counted, but their cost is not. The totals in this report are therefore a floor, not a complete picture. Add prices for these SKUs to close the gap:
    <ul>
$names
    </ul>
  </div>
"@
    }
    else { '' }

    @"
<section class="ch-layer">
  <div class="ch-layer-head">
    <h2>Executive summary</h2>
    <span class="ch-audience">CISO &middot; CIO &middot; CFO</span>
  </div>

  <h3>Annual commitment by product</h3>
  $chart

$pricingNote
$unpricedNote

  <div class="ch-note ch-note--pending">
    <strong>Still to come in this report</strong>
    <ul>
      <li>Entitled-but-unconfigured security features, and what they cost you (M3)</li>
      <li>The remaining four seat-waste categories: disabled-but-licensed, never-signed-in, inactive beyond threshold, and over-provisioned (M3)</li>
      <li>Secure Score, peer benchmark and 90-day trend (M2)</li>
      <li>Dollarized risk reduction for the highest-impact undeployed control (M4)</li>
      <li>Prioritized remediation roadmap (M4)</li>
    </ul>
  </div>
</section>
"@
}

function Get-CHSIHtmlArchitectLayer {
    <#
    .SYNOPSIS
        Layer 3: the per-SKU detail, the exclusions, and the provenance of every number.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)][object]$Report)

    $currency = $Report.Spend.Currency
    $spend = $Report.Spend

    # --- Inventory table -------------------------------------------------------
    $rows = foreach ($item in ($Report.Inventory | Sort-Object -Property @{ E = { $_.Excluded } }, @{ E = { -($_.AnnualCommitment ?? 0) } }, DisplayName)) {
        $rowClass = if ($item.Excluded) { ' class="ch-muted-row"' } else { '' }
        $priceCell = if ($item.PriceKnown) { Format-CHSICurrency $item.UnitPriceMonthly -Currency $currency -Decimals 2 } else { '<span class="ch-pill">no price</span>' }
        $commitCell = if ($item.Excluded) { '&mdash;' } elseif ($item.PriceKnown) { Format-CHSICurrency $item.AnnualCommitment -Currency $currency } else { '&mdash;' }
        $idleCell = if ($item.Excluded) { '&mdash;' } elseif ($item.PriceKnown) { Format-CHSICurrency $item.UnassignedSeatCost -Currency $currency } else { '&mdash;' }
        $utilCell = if ($item.Excluded) { '&mdash;' } else { Format-CHSIPercent $item.SeatUtilization }

        @"
      <tr$rowClass>
        <td>$(ConvertTo-CHSIHtmlEncoded $item.DisplayName)$(if ($item.NamingTrap) { ' <span class="ch-pill ch-pill--attention" title="' + (ConvertTo-CHSIHtmlEncoded $item.NamingTrap) + '">naming trap</span>' })$(if (-not $item.InCatalog) { ' <span class="ch-pill">unrecognized</span>' })</td>
        <td><code>$(ConvertTo-CHSIHtmlEncoded $item.SkuPartNumber)</code></td>
        <td class="ch-num">$('{0:N0}' -f $item.PurchasedUnits)</td>
        <td class="ch-num">$('{0:N0}' -f $item.ConsumedUnits)</td>
        <td class="ch-num">$('{0:N0}' -f $item.UnassignedUnits)</td>
        <td class="ch-num">$utilCell</td>
        <td class="ch-num">$priceCell</td>
        <td class="ch-num">$commitCell</td>
        <td class="ch-num">$idleCell</td>
      </tr>
"@
    }

    # --- Exclusions ------------------------------------------------------------
    $exclusionRows = foreach ($item in ($Report.Inventory | Where-Object Excluded)) {
        @"
      <tr>
        <td>$(ConvertTo-CHSIHtmlEncoded $item.DisplayName)</td>
        <td><code>$(ConvertTo-CHSIHtmlEncoded $item.SkuPartNumber)</code></td>
        <td class="ch-num">$('{0:N0}' -f $item.PurchasedUnits)</td>
        <td>$(ConvertTo-CHSIHtmlEncoded $item.ExclusionReason)</td>
      </tr>
"@
    }

    $exclusionSection = if (@($exclusionRows).Count -gt 0) {
        @"
  <h3>Excluded from all totals</h3>
  <p>Free and self-service SKUs report implausible "unlimited" seat counts that would otherwise dominate every figure in this report. They are listed here so the exclusion is visible rather than silent.</p>
  <div class="ch-table-wrap">
    <table class="ch-table">
      <thead><tr><th>Product</th><th>Part number</th><th class="ch-num">Reported seats</th><th>Why excluded</th></tr></thead>
      <tbody>
$($exclusionRows -join "`n")
      </tbody>
    </table>
  </div>
"@
    }
    else { '' }

    # --- Provenance ------------------------------------------------------------
    $scopeRows = foreach ($scope in $Report.Provenance.Scopes) {
        $state = if ($scope.Granted) { '<span class="ch-pill ch-pill--ok">granted</span>' }
                 elseif ($scope.Required) { '<span class="ch-pill ch-pill--attention">missing</span>' }
                 else { '<span class="ch-pill">not granted</span>' }
        @"
      <tr>
        <td><code>$(ConvertTo-CHSIHtmlEncoded $scope.Scope)</code></td>
        <td>$state</td>
        <td>$(ConvertTo-CHSIHtmlEncoded $scope.Purpose)</td>
        <td>$(ConvertTo-CHSIHtmlEncoded $scope.LeastPrivilegeRole)</td>
      </tr>
"@
    }

    $collectorRows = foreach ($collector in $Report.Provenance.Collectors) {
        $state = if (-not $collector.Available) { '<span class="ch-pill ch-pill--attention">unavailable</span>' }
                 elseif ($collector.Degraded) { '<span class="ch-pill ch-pill--attention">degraded</span>' }
                 else { '<span class="ch-pill ch-pill--ok">complete</span>' }
        @"
      <tr>
        <td><code>$(ConvertTo-CHSIHtmlEncoded $collector.Name)</code></td>
        <td>$state</td>
        <td>$(ConvertTo-CHSIHtmlEncoded $collector.Reason)</td>
      </tr>
"@
    }

    @"
<section class="ch-layer">
  <div class="ch-layer-head">
    <h2>Architect appendix</h2>
    <span class="ch-audience">Security architect</span>
  </div>

  <h3>Licence inventory</h3>
  <div class="ch-table-wrap">
    <table class="ch-table">
      <thead>
        <tr>
          <th>Product</th><th>Part number</th>
          <th class="ch-num">Purchased</th><th class="ch-num">Assigned</th><th class="ch-num">Unassigned</th>
          <th class="ch-num">Utilization</th>
          <th class="ch-num">Unit / mo</th><th class="ch-num">Annual commitment</th><th class="ch-num">Idle cost</th>
        </tr>
      </thead>
      <tbody>
$($rows -join "`n")
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2">Total (priced, non-excluded)</td>
          <td class="ch-num">$('{0:N0}' -f $spend.SeatsPurchased)</td>
          <td class="ch-num">$('{0:N0}' -f $spend.SeatsConsumed)</td>
          <td class="ch-num">$('{0:N0}' -f $spend.SeatsUnassigned)</td>
          <td class="ch-num">$(Format-CHSIPercent $Report.Realization.Seat.Ratio)</td>
          <td class="ch-num">&mdash;</td>
          <td class="ch-num">$(Format-CHSICurrency $spend.AnnualCommitment -Currency $currency)</td>
          <td class="ch-num">$(Format-CHSICurrency $spend.UnassignedSeatCost -Currency $currency)</td>
        </tr>
      </tfoot>
    </table>
  </div>

$exclusionSection

  <h3>Read-only scopes used</h3>
  <div class="ch-table-wrap">
    <table class="ch-table">
      <thead><tr><th>Scope</th><th>State</th><th>Why it is needed</th><th>Least-privilege role</th></tr></thead>
      <tbody>
$($scopeRows -join "`n")
      </tbody>
    </table>
  </div>

$(
  # @() around every access: a report model reloaded from JSON turns a one-element
  # array back into a scalar, and a string has no .Count under Set-StrictMode.
  $extraScopes = @($Report.Provenance.ExtraScopes)
  $extraWriteScopes = @($Report.Provenance.ExtraWriteScopes)
  if ($extraScopes.Count -gt 0) {
    $extraList = ($extraScopes | ForEach-Object { "<li><code>$(ConvertTo-CHSIHtmlEncoded $_)</code></li>" }) -join "`n"
    $writeWarning = if ($extraWriteScopes.Count -gt 0) {
        " <strong>$($extraWriteScopes.Count) of these grant write access.</strong> This tool never uses them &mdash; every call it makes is a GET &mdash; but the session presented to Microsoft Graph was broader than least privilege. Reconnect with a dedicated least-privilege session before producing a client deliverable."
    } else { '' }
    @"
  <div class="ch-note ch-note--warning">
    <strong>The signed-in session carried $($Report.Provenance.ExtraScopes.Count) scope(s) beyond what this tool requests</strong>
    Microsoft Graph reuses whatever cached token is available, so a session created for other work can carry more permission than this report needs.$writeWarning
    <ul>
$extraList
    </ul>
  </div>
"@
  }
)

  <h3>Collection provenance</h3>
  <div class="ch-table-wrap">
    <table class="ch-table">
      <thead><tr><th>Collector</th><th>State</th><th>Detail</th></tr></thead>
      <tbody>
$($collectorRows -join "`n")
      </tbody>
    </table>
  </div>

  <h3>Methodology</h3>
  <dl class="ch-defs">
    <dt>Annual licence commitment</dt>
    <dd>Purchased seats x unit price x 12. This is what most enterprise and CSP agreements actually invoice, whether or not a seat is assigned.</dd>
    <dt>Spend in use</dt>
    <dd>Assigned seats x unit price x 12. The portion of the commitment that is in someone's hands.</dd>
    <dt>Idle seat spend</dt>
    <dd>The difference between the two: purchased seats that are not assigned to any account. Category 1 of five seat-waste categories.</dd>
    <dt>Seat realization</dt>
    <dd>Assigned seats divided by purchased seats. Reported as "n/a" rather than 0% where no seats were purchased.</dd>
    <dt>Security value share</dt>
    <dd>The fraction of a SKU's price this tool attributes to its security capabilities, used from milestone M3 to dollarize unconfigured features. It is this tool's allocation model, not a Microsoft-published figure, and is overridable per SKU.</dd>
    <dt>Expected loss</dt>
    <dd>Likelihood x impact, both supplied as engagement assumptions rather than measured. Used from milestone M4.</dd>
  </dl>
</section>
"@
}

function Get-CHSIHtmlFooter {
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)][object]$Report)

    @"
<footer class="ch-footer">
  <div class="ch-readonly">Read-only: this tool issues Microsoft Graph GET requests exclusively. It never writes to, or remediates, the tenant.</div>
  <p>Generated by $(ConvertTo-CHSIHtmlEncoded $Report.Tool.Name) v$(ConvertTo-CHSIHtmlEncoded $Report.Tool.Version) on $(([datetime]$Report.GeneratedAt).ToString('dd MMMM yyyy HH:mm')) UTC$(if ($Report.Provenance.Source -eq 'Snapshot') { ' from a saved snapshot' }).</p>
  <p>Tenant $(ConvertTo-CHSIHtmlEncoded $Report.Tenant.TenantId). Microsoft Graph does not expose contract pricing; all monetary figures derive from the supplied price table.</p>
  <p>M365 Security Investment Report &mdash; open source, MIT licensed.</p>
</footer>
"@
}
