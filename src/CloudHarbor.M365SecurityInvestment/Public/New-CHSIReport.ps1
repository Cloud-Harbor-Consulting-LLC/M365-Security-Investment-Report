function New-CHSIReport {
    <#
    .SYNOPSIS
        Collects, analyses and exports a Microsoft 365 Security Investment Report in one call.

    .DESCRIPTION
        The normal entry point. Connect first with Connect-CHSITenant, then run this.

        -FromSnapshot re-analyses a saved snapshot with no credentials and no network,
        which is how the offline test suite exercises the whole pipeline and how a
        snapshot taken on site can be re-priced later without going back to the tenant.

        Read-only throughout: every Graph call this module makes is a GET.

    .PARAMETER OutputPath
        Directory for the generated files. Defaults to the current directory.

    .PARAMETER BaseName
        Base file name for the generated files. Defaults to a name derived from the tenant
        domain and the run date.

    .PARAMETER ConfigPath
        Configuration file for pricing basis, thresholds, exemptions and risk inputs.

    .PARAMETER CustomPricing
        Price list with negotiated EA or CSP rates, replacing the shipped list prices.

    .PARAMETER FromSnapshot
        Path to a snapshot JSON file to analyse instead of connecting to a tenant.

    .PARAMETER SaveSnapshot
        Path to write the collected snapshot to. Off by default; v1.0 keeps no state
        between runs.

    .PARAMETER Format
        Which output formats to write. Defaults to all three.

    .PARAMETER PassThru
        Return the report model as well as writing files.

    .EXAMPLE
        Connect-CHSITenant -TenantId contoso.onmicrosoft.com
        New-CHSIReport -OutputPath .\out

    .EXAMPLE
        New-CHSIReport -FromSnapshot .\tests\fixtures\premium-snapshot.json -OutputPath .\out

    .EXAMPLE
        New-CHSIReport -CustomPricing .\contoso-ea-rates.json -ConfigPath .\contoso.json -OutputPath .\out
    #>
    [CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Live')]
    [OutputType([pscustomobject])]
    param(
        [string]$OutputPath = '.',

        [string]$BaseName,

        [string]$ConfigPath,

        [string]$CustomPricing,

        [Parameter(Mandatory, ParameterSetName = 'Snapshot')]
        [ValidateNotNullOrEmpty()]
        [string]$FromSnapshot,

        [Parameter(ParameterSetName = 'Live')]
        [string]$SaveSnapshot,

        [ValidateSet('Html', 'Json', 'Csv')]
        [string[]]$Format = @('Html', 'Json', 'Csv'),

        [switch]$PassThru
    )

    if (-not $PSCmdlet.ShouldProcess($OutputPath, 'Generate Microsoft 365 Security Investment Report')) {
        return
    }

    # --- Collect (or load) -----------------------------------------------------
    $snapshot = if ($PSCmdlet.ParameterSetName -eq 'Snapshot') {
        if (-not (Test-Path -LiteralPath $FromSnapshot)) {
            throw "Snapshot file not found: '$FromSnapshot'."
        }
        Write-Verbose "Analysing saved snapshot '$FromSnapshot' (offline; no tenant connection required)."
        Clear-CHSIRunLog -Confirm:$false
        Get-Content -LiteralPath $FromSnapshot -Raw -Encoding utf8 | ConvertFrom-Json -Depth 20
    }
    else {
        $params = @{}
        if ($SaveSnapshot) { $params['Path'] = $SaveSnapshot }
        Get-CHSISnapshot @params
    }

    # --- Analyse ---------------------------------------------------------------
    $analysisParams = @{ Snapshot = $snapshot }
    if ($ConfigPath)    { $analysisParams['ConfigPath'] = $ConfigPath }
    if ($CustomPricing) { $analysisParams['CustomPricing'] = $CustomPricing }

    $report = Invoke-CHSIAnalysis @analysisParams

    # --- Export ----------------------------------------------------------------
    $exportParams = @{ Report = $report; OutputPath = $OutputPath; Format = $Format }
    if ($BaseName) { $exportParams['BaseName'] = $BaseName }
    $exported = Export-CHSIReport @exportParams

    if (-not $report.Spend.PricingVerified) {
        Write-Warning 'Dollar figures use unverified seed list prices. Verify them, or supply negotiated rates with -CustomPricing, before sharing this report with a client.'
    }
    if ($report.Spend.SkuCountUnpriced -gt 0) {
        Write-Warning "$($report.Spend.SkuCountUnpriced) SKU(s) have no price and are excluded from all dollar totals. The figures in this report are a floor, not a complete picture."
    }

    if ($PassThru) {
        [pscustomobject]@{
            Report   = $report
            Snapshot = $snapshot
            Export   = $exported
        }
    }
    else {
        $exported
    }
}
