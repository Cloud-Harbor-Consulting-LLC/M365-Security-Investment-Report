function ConvertTo-CHSIFriendlySkuName {
    <#
    .SYNOPSIS
        A readable rendering of a part number Microsoft publishes no display name for.

    .DESCRIPTION
        Mirrors humanizePartNumber in app/src/engine/inventory.ts. Both tiers must render
        the same product name for the same tenant, so the two implementations are checked
        against each other by a parity test.

        This formats Microsoft's own identifier -- MICROSOFT_AGENT_365_TIER_3 becomes
        "Microsoft Agent 365 Tier 3" -- rather than inventing a product name. Newer and
        partner SKUs reach tenants before they reach the licensing reference, and
        third-party licensing blogs are not a source this report should quote a product
        name from. The row still carries the raw part number and is still flagged as
        unrecognised, so a tidied string is never mistaken for a catalogue match.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$PartNumber
    )

    $words = @(
        ($PartNumber -replace '[_\-]+', ' ') -replace '\s+', ' ' |
            ForEach-Object { $_.Trim() } |
            ForEach-Object { $_ -split ' ' } |
            Where-Object { $_ }
    )

    $rendered = foreach ($word in $words) {
        if (($word -cmatch '[a-z]') -and ($word -cmatch '[A-Z]')) {
            # Already mixed-case and readable as it stands, e.g. Microsoft_365_Copilot.
            $word
        }
        elseif ($word -match '^\d+$') {
            $word
        }
        elseif ($word.Length -le 2 -or $word -match '^(RPA|CRM|ATP|DLP|MFA|SMB|VDI|GCC|USL|XPLAT|IOT|API|SKU)$') {
            $word.ToUpperInvariant()
        }
        else {
            $word.Substring(0, 1).ToUpperInvariant() + $word.Substring(1).ToLowerInvariant()
        }
    }

    return ($rendered -join ' ')
}
