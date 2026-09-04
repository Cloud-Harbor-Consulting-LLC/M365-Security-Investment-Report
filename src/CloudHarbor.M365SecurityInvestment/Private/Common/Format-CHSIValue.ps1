function Format-CHSICurrency {
    <#
    .SYNOPSIS
        Formats a number as currency for report display.
    .DESCRIPTION
        v1.0 is single-currency: the symbol comes from config and no conversion is ever
        performed. Whole dollars by default, because cents in a board one-pager are noise.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory, Position = 0)]
        [AllowNull()]
        [Nullable[double]]$Value,

        [string]$Currency = 'USD',

        [int]$Decimals = 0,

        [string]$NullText = 'n/a'
    )

    if ($null -eq $Value) { return $NullText }

    $symbol = switch ($Currency) {
        'USD'   { '$' }
        'EUR'   { [char]0x20AC }
        'GBP'   { [char]0x00A3 }
        'CAD'   { '$' }
        'AUD'   { '$' }
        default { '' }
    }

    $formatted = $Value.ToString("N$Decimals", [cultureinfo]::InvariantCulture)
    if ($symbol) { "$symbol$formatted" } else { "$formatted $Currency" }
}

function Format-CHSIPercent {
    <#
    .SYNOPSIS
        Formats a 0..1 ratio as a percentage string.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory, Position = 0)]
        [AllowNull()]
        [Nullable[double]]$Ratio,

        [int]$Decimals = 0,

        [string]$NullText = 'n/a'
    )

    if ($null -eq $Ratio) { return $NullText }
    ($Ratio * 100).ToString("N$Decimals", [cultureinfo]::InvariantCulture) + '%'
}

function ConvertTo-CHSISafeRatio {
    <#
    .SYNOPSIS
        Division that returns $null instead of throwing or fabricating a zero when the
        denominator is zero.
    .DESCRIPTION
        Used everywhere a realization percentage is computed. "No seats purchased" must
        render as "n/a", not as "0% realized" -- the distinction matters to the reader.
    #>
    [CmdletBinding()]
    [OutputType([Nullable[double]])]
    param(
        [Parameter(Mandatory, Position = 0)][double]$Numerator,
        [Parameter(Mandatory, Position = 1)][double]$Denominator
    )

    if ($Denominator -eq 0) { return $null }
    $Numerator / $Denominator
}
