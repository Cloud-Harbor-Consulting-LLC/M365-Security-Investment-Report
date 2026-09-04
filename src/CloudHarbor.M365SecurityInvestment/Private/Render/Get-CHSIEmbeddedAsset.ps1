function Get-CHSIEmbeddedAsset {
    <#
    .SYNOPSIS
        Loads a brand asset for inlining into the self-contained report.

    .DESCRIPTION
        The report must render offline, so nothing is ever fetched at view time. Binary
        assets such as fonts become base64 data URIs; text assets such as the stylesheet
        are inlined raw.

        This project ships no logo or wordmark. It is open source and forkable, and a
        trademark travelling with every fork would be wrong for the forker and for the
        trademark owner alike. The palette and the typeface carry the visual identity;
        callers who want a mark of their own can add one in their own build.
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
