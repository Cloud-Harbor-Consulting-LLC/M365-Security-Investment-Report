function Get-CHSIDataFile {
    <#
    .SYNOPSIS
        Loads one of the module's shipped JSON data files (SKU catalog, price list,
        feature map, risk model).

    .DESCRIPTION
        These files are the module's maintainable IP: adding a SKU or a security feature
        should be a JSON edit, never a code change. Results are cached per session because
        they do not change mid-run.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateSet('sku-catalog', 'pricelist', 'feature-map', 'risk-model')]
        [string]$Name,

        [switch]$NoCache
    )

    if ($null -eq $script:CHSIDataCache) {
        $script:CHSIDataCache = @{}
    }

    if (-not $NoCache -and $script:CHSIDataCache.ContainsKey($Name)) {
        return $script:CHSIDataCache[$Name]
    }

    $path = Join-Path $script:CHSIDataPath "$Name.json"
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required data file '$Name.json' was not found at '$path'. The module installation is incomplete."
    }

    try {
        $data = Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json -Depth 20
    }
    catch {
        throw "Data file '$Name.json' is not valid JSON: $($_.Exception.Message)"
    }

    $script:CHSIDataCache[$Name] = $data
    $data
}
