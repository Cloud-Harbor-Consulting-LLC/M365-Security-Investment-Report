function Get-CHSIDefaultConfig {
    <#
    .SYNOPSIS
        The built-in configuration. Every value here is overridable from a config file.

    .DESCRIPTION
        Loaded from Data/default-config.json rather than declared here, because the
        TypeScript engine reads the same file. Two copies of "what does
        unrecognizedSeatThreshold default to" is exactly the drift the single-engine
        decision exists to prevent.

        Keys beginning with '$' are documentation and are stripped.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    $path = Join-Path $script:CHSIDataPath 'default-config.json'
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required data file 'default-config.json' was not found at '$path'. The module installation is incomplete."
    }

    try {
        $raw = Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json -Depth 20 -AsHashtable
    }
    catch {
        throw "Data file 'default-config.json' is not valid JSON: $($_.Exception.Message)"
    }

    Remove-CHSIDocumentationKey -Table $raw
}

function Remove-CHSIDocumentationKey {
    <#
    .SYNOPSIS
        Recursively drops '$'-prefixed documentation keys from a parsed JSON hashtable.
    .DESCRIPTION
        JSON has no comments, so the shared data files carry their rationale in '$notes'
        keys. Those belong in the file, not in the config object the report renders.
    #>
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '',
        Justification = 'Returns a filtered copy. The input hashtable is not modified and nothing outside the pipeline changes.')]
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Table
    )

    $clean = @{}
    foreach ($key in $Table.Keys) {
        if ($key -like '$*') { continue }
        $value = $Table[$key]
        $clean[$key] = if ($value -is [hashtable]) { Remove-CHSIDocumentationKey -Table $value } else { $value }
    }
    $clean
}

function Import-CHSIConfig {
    <#
    .SYNOPSIS
        Loads configuration, layering a user config file over the built-in defaults.

    .DESCRIPTION
        Merge is recursive: a config file that sets only inactivity.thresholdDays keeps
        every other default. Unknown keys are passed through rather than rejected, so a
        config written for a newer version still loads.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [string]$Path
    )

    $config = Get-CHSIDefaultConfig

    if (-not $Path) {
        Write-CHSILog -Level Debug -Source 'Config' -Message 'No config file supplied; using built-in defaults.'
        return $config
    }

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Configuration file not found: '$Path'."
    }

    try {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json -Depth 20 -AsHashtable
    }
    catch {
        throw "Configuration file '$Path' is not valid JSON: $($_.Exception.Message)"
    }

    $merged = Merge-CHSIHashtable -Base $config -Override $raw
    Write-CHSILog -Level Info -Source 'Config' -Message "Loaded configuration from '$Path'."
    $merged
}

function Merge-CHSIHashtable {
    <#
    .SYNOPSIS
        Recursively merges $Override onto a copy of $Base. Arrays replace rather than append.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][hashtable]$Base,
        [Parameter(Mandatory)][hashtable]$Override
    )

    $result = @{}
    foreach ($key in $Base.Keys) { $result[$key] = $Base[$key] }

    foreach ($key in $Override.Keys) {
        $overrideValue = $Override[$key]

        if ($result.ContainsKey($key) -and $result[$key] -is [hashtable] -and $overrideValue -is [hashtable]) {
            $result[$key] = Merge-CHSIHashtable -Base $result[$key] -Override $overrideValue
        }
        else {
            $result[$key] = $overrideValue
        }
    }

    $result
}
