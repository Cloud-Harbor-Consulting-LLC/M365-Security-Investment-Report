function New-CHSICollectorResult {
    <#
    .SYNOPSIS
        Standard envelope returned by every collector.

    .DESCRIPTION
        Collectors never throw for a missing entitlement -- they return a result that says
        what happened. The report then renders "not measured, and here is why" rather than
        a zero. A CFO-facing document must never show $0 where the truth is "we could not
        look."

    .PARAMETER Available
        False when the signal could not be collected at all.

    .PARAMETER Degraded
        True when the signal was collected but is incomplete (e.g. users returned, but
        without sign-in activity because the tenant lacks Entra ID P1).
    #>
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '',
        Justification = 'Constructs an in-memory object. Nothing outside the pipeline is created or changed.')]
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [object]$Data,

        [bool]$Available = $true,

        [bool]$Degraded = $false,

        [string]$Reason,

        [string[]]$Notes = @()
    )

    [pscustomobject]@{
        Name        = $Name
        Available   = $Available
        Degraded    = $Degraded
        Reason      = $Reason
        Notes       = @($Notes)
        CollectedAt = [datetime]::UtcNow
        Data        = $Data
    }
}
