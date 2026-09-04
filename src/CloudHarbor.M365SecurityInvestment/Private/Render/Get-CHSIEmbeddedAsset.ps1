function Get-CHSIEmbeddedAsset {
    <#
    .SYNOPSIS
        Loads a brand asset for inlining into the self-contained report.

    .DESCRIPTION
        The report must render offline and survive being emailed as an attachment, so
        nothing is ever fetched at view time. Fonts and the favicon become base64 data
        URIs; the logo is inlined as raw SVG markup instead, so it can inherit
        currentColor rather than shipping one copy per brand colour.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$RelativePath,

        [ValidateSet('Base64', 'Raw')]
        [string]$As = 'Base64'
    )

    $path = Join-Path $script:CHSIAssetPath $RelativePath
    if (-not (Test-Path -LiteralPath $path)) {
        Write-CHSILog -Level Warning -Source 'Render' -Message "Brand asset '$RelativePath' is missing; the report will render without it."
        return ''
    }

    if ($As -eq 'Raw') {
        return (Get-Content -LiteralPath $path -Raw -Encoding utf8)
    }

    [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($path))
}

function Get-CHSILogoMarkup {
    <#
    .SYNOPSIS
        Returns the Cloud Harbor horizontal logo as inline SVG, recolourable via CSS.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [string]$CssClass = 'ch-logo'
    )

    $svg = Get-CHSIEmbeddedAsset -RelativePath 'logo-horizontal.svg' -As Raw
    if (-not $svg) { return '' }

    # Strip the XML prolog and any DOCTYPE so the markup can be inlined into HTML,
    # then hand colour control to CSS.
    $svg = $svg -replace '(?s)<\?xml.*?\?>', ''
    $svg = $svg -replace '(?s)<!DOCTYPE.*?>', ''
    $svg = $svg -replace 'fill="#[0-9a-fA-F]{6}"', 'fill="currentColor"'
    $svg = $svg -replace '<svg ', "<svg class=`"$CssClass`" role=`"img`" aria-label=`"Cloud Harbor Consulting`" "

    $svg.Trim()
}

function ConvertTo-CHSIHtmlEncoded {
    <#
    .SYNOPSIS
        HTML-encodes a value for safe interpolation into the report.
    .DESCRIPTION
        Tenant display names, SKU part numbers and config-supplied strings all reach the
        document, and any of them can contain characters that would otherwise break or
        inject markup.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Position = 0, ValueFromPipeline)]
        [AllowNull()]
        [AllowEmptyString()]
        [object]$Value
    )

    process {
        if ($null -eq $Value) { return '' }
        [System.Net.WebUtility]::HtmlEncode([string]$Value)
    }
}
