function Get-CHSIDefaultConfig {
    <#
    .SYNOPSIS
        The built-in configuration. Every value here is overridable from a config file.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    @{
        pricing    = @{
            # 'MicrosoftListPrice' or 'CustomNegotiated'. Rendered verbatim in the report
            # header, because a CFO will ask which basis produced the numbers.
            basis             = 'MicrosoftListPrice'
            currency          = 'USD'
            customPricingPath = $null
        }
        inactivity = @{
            thresholdDays = 90
        }
        exemptions = @{
            # Accounts that legitimately hold a license but rarely or never sign in:
            # service accounts, shared mailboxes, room and equipment resources.
            userPrincipalNames  = @()
            displayNamePatterns = @()
            userTypes           = @('Guest')
        }
        skus       = @{
            # Free and self-service SKUs report implausible "unlimited" seat counts,
            # in practice either 1,000,000 or 10,000. Two thresholds, because the two
            # values need different treatment:
            #
            #   unlimitedSeatThreshold      -- no tenant buys this many seats of anything.
            #                                  Safe to exclude on the count alone.
            #   unrecognizedSeatThreshold   -- 10,000 is a plausible enterprise purchase,
            #                                  so the count alone is not enough. Only
            #                                  applied when the SKU is also absent from
            #                                  the catalog AND has no price, which makes a
            #                                  viral trial far likelier than a real buy.
            unlimitedSeatThreshold    = 100000
            unrecognizedSeatThreshold = 10000
            excludeSkuPartNumbers     = @()
        }
        risk       = @{
            # Expected Loss = Likelihood x Impact. Defaults are deliberately conservative
            # placeholders; override them per engagement.
            annualLikelihood = 0.15
            impactUsd        = 500000
        }
        report     = @{
            organizationName = $null
            preparedFor      = $null
            # No default. This is open source: a report should carry the name of whoever
            # actually prepared it, or no name at all, never the original author's.
            preparedBy       = $null
            includeArchitectAppendix = $true
        }
    }
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
