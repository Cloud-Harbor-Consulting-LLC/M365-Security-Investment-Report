function New-CHSIGaugeSvg {
    <#
    .SYNOPSIS
        A single-value arc gauge, drawn as inline SVG.

    .DESCRIPTION
        Hand-drawn SVG rather than a charting library: the report is a single offline file
        with no CDN, and pulling in a 200 KB chart bundle to draw one arc would be a poor
        trade. Renders an explicit "not measured" state rather than an empty ring, because
        a blank gauge reads as zero.
    #>
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '',
        Justification = 'Returns an SVG string. Changes no state.')]
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [Nullable[double]]$Ratio,

        [string]$Label = '',

        [string]$UnavailableText = 'Not measured',

        [int]$Size = 180
    )

    $stroke = 16
    $radius = ($Size / 2) - ($stroke / 2) - 2
    $cx = $Size / 2
    $cy = $Size / 2
    $circumference = 2 * [Math]::PI * $radius

    # Three-quarter arc, rotated so the gap sits at the bottom.
    $arcFraction = 0.75
    $trackLength = $circumference * $arcFraction

    if ($null -eq $Ratio) {
        $centreText = '&mdash;'
        $subText = $UnavailableText
        $valueLength = 0
        $valueClass = 'ch-gauge-value ch-gauge-value--unavailable'
    }
    else {
        # 0.0/1.0, not 0/1: integer literals make PowerShell bind Math::Min(int,int)
        # and silently round the ratio to a whole number.
        $clamped = [Math]::Max(0.0, [Math]::Min(1.0, [double]$Ratio))
        $centreText = Format-CHSIPercent $clamped
        $subText = $Label
        $valueLength = $trackLength * $clamped
        $valueClass = 'ch-gauge-value'
    }

    $rotation = 135

    @"
<svg class="ch-gauge" viewBox="0 0 $Size $Size" width="$Size" height="$Size" role="img" aria-label="$([System.Net.WebUtility]::HtmlEncode("$Label $centreText"))">
  <g transform="rotate($rotation $cx $cy)">
    <circle class="ch-gauge-track" cx="$cx" cy="$cy" r="$([Math]::Round($radius,2))" fill="none" stroke-width="$stroke"
            stroke-dasharray="$([Math]::Round($trackLength,2)) $([Math]::Round($circumference,2))" stroke-linecap="round" />
    <circle class="$valueClass" cx="$cx" cy="$cy" r="$([Math]::Round($radius,2))" fill="none" stroke-width="$stroke"
            stroke-dasharray="$([Math]::Round($valueLength,2)) $([Math]::Round($circumference,2))" stroke-linecap="round" />
  </g>
  <text class="ch-gauge-centre" x="$cx" y="$($cy + 2)" text-anchor="middle" dominant-baseline="middle">$centreText</text>
  <text class="ch-gauge-sub" x="$cx" y="$($cy + 30)" text-anchor="middle" dominant-baseline="middle">$([System.Net.WebUtility]::HtmlEncode($subText))</text>
</svg>
"@
}

function New-CHSIHorizontalBarSvg {
    <#
    .SYNOPSIS
        A horizontal bar chart of labelled values, drawn as inline SVG.

    .PARAMETER Item
        Objects with Label, Value and optionally ValueText properties.
    #>
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '',
        Justification = 'Returns an SVG string. Changes no state.')]
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Item,

        [int]$Width = 720,

        [int]$BarHeight = 26,

        [int]$Gap = 12,

        [int]$LabelWidth = 240
    )

    $items = @($Item)
    if ($items.Count -eq 0) {
        return '<p class="ch-empty">No data to chart.</p>'
    }

    $max = [double](@($items | ForEach-Object { [double]$_.Value } | Measure-Object -Maximum).Maximum)
    if ($max -le 0) { $max = 1 }

    $plotWidth = $Width - $LabelWidth - 110
    $height = ($items.Count * ($BarHeight + $Gap)) + $Gap

    $rows = foreach ($i in 0..($items.Count - 1)) {
        $entry = $items[$i]
        $y = $Gap + ($i * ($BarHeight + $Gap))
        $barWidth = [Math]::Max(2.0, [Math]::Round($plotWidth * ([double]$entry.Value / $max), 2))
        $label = [System.Net.WebUtility]::HtmlEncode([string]$entry.Label)
        $valueText = if ($entry.PSObject.Properties['ValueText'] -and $entry.ValueText) {
            [System.Net.WebUtility]::HtmlEncode([string]$entry.ValueText)
        }
        else {
            '{0:N0}' -f [double]$entry.Value
        }

        @"
  <g>
    <text class="ch-bar-label" x="$($LabelWidth - 10)" y="$($y + ($BarHeight / 2))" text-anchor="end" dominant-baseline="middle">$label</text>
    <rect class="ch-bar-track" x="$LabelWidth" y="$y" width="$plotWidth" height="$BarHeight" rx="3" />
    <rect class="ch-bar-value" x="$LabelWidth" y="$y" width="$barWidth" height="$BarHeight" rx="3" />
    <text class="ch-bar-figure" x="$($LabelWidth + $barWidth + 10)" y="$($y + ($BarHeight / 2))" dominant-baseline="middle">$valueText</text>
  </g>
"@
    }

    @"
<svg class="ch-barchart" viewBox="0 0 $Width $height" width="100%" height="$height" role="img" aria-label="Bar chart">
$($rows -join "`n")
</svg>
"@
}
