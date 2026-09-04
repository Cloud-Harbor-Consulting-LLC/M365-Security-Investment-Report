function Invoke-CHSIAnalysis {
    <#
    .SYNOPSIS
        Turns a tenant snapshot into the analysed report model.

    .DESCRIPTION
        Pure: snapshot in, model out, no network calls and no credentials. That is what
        makes fixture-driven tests genuine end-to-end coverage rather than stubs, and it
        is why a snapshot captured on a client site can be re-analysed later with
        different pricing without going back to the tenant.

    .PARAMETER Snapshot
        A snapshot from Get-CHSISnapshot, or one loaded from JSON.

    .PARAMETER ConfigPath
        Optional configuration file. Built-in defaults are used when omitted.

    .PARAMETER CustomPricing
        Path to a price list overriding the shipped Microsoft list prices with negotiated
        EA or CSP rates. Switches the report's stated pricing basis accordingly.

    .EXAMPLE
        $report = Invoke-CHSIAnalysis -Snapshot $snapshot -CustomPricing .\contoso-rates.json
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory, ValueFromPipeline)]
        [object]$Snapshot,

        [string]$ConfigPath,

        [string]$CustomPricing
    )

    process {
        $config = Import-CHSIConfig -Path $ConfigPath

        # --- Pricing -----------------------------------------------------------
        $priceList = if ($CustomPricing) {
            if (-not (Test-Path -LiteralPath $CustomPricing)) {
                throw "Custom pricing file not found: '$CustomPricing'."
            }
            $custom = Get-Content -LiteralPath $CustomPricing -Raw -Encoding utf8 | ConvertFrom-Json -Depth 20
            $config.pricing.basis = if ($custom.PSObject.Properties['basis']) { $custom.basis } else { 'CustomNegotiated' }
            if ($custom.PSObject.Properties['currency']) { $config.pricing.currency = $custom.currency }
            Write-CHSILog -Level Info -Source 'Analyze' -Message "Using customer-supplied pricing from '$CustomPricing'."
            $custom
        }
        else {
            Get-CHSIDataFile -Name 'pricelist'
        }

        # --- Required inputs ---------------------------------------------------
        $orgCollector = $Snapshot.Collectors.organization
        $skuCollector = $Snapshot.Collectors.subscribedSkus

        if (-not $skuCollector.Available) {
            throw "Cannot analyse: the subscribed SKU collection is unavailable. $($skuCollector.Reason)"
        }

        $tenant = if ($orgCollector.Available) {
            $orgCollector.Data
        }
        else {
            Write-CHSILog -Level Warning -Source 'Analyze' -Message 'Organization data unavailable; falling back to the tenant id from the collection context.'
            [pscustomobject]@{
                TenantId        = $Snapshot.Context.TenantId
                DisplayName     = 'Unknown tenant'
                DefaultDomain   = $null
                VerifiedDomains = @()
            }
        }

        # --- Analysis ----------------------------------------------------------
        $inventory = @(Resolve-CHSISku -Sku @($skuCollector.Data) -Config $config -PriceList $priceList)
        $spend = Measure-CHSISpend -Inventory $inventory -Config $config -PriceList $priceList
        $realization = Measure-CHSISpendRealization -Spend $spend

        # --- Provenance --------------------------------------------------------
        $collectorSummary = foreach ($property in $Snapshot.Collectors.PSObject.Properties) {
            $collector = $property.Value
            [pscustomobject]@{
                Name      = $collector.Name
                Available = $collector.Available
                Degraded  = $collector.Degraded
                Reason    = if ($collector.Reason) { $collector.Reason } elseif ($collector.Available) { 'Collected without error.' } else { 'Unavailable.' }
            }
        }

        $assessment = if ($Snapshot.PSObject.Properties['ScopeAssessment'] -and $Snapshot.ScopeAssessment) {
            $Snapshot.ScopeAssessment
        }
        else {
            Assert-CHSIScope -GrantedScope @($Snapshot.Context.Scopes) -WarningAction SilentlyContinue
        }

        # The outer @() is load-bearing: an if-expression returning a one-element array
        # unrolls to a scalar on assignment, and a bare string has no .Count under
        # Set-StrictMode. Same reason a single-element array survives a JSON round-trip
        # as a scalar.
        $scopes = @($assessment.Scopes)
        $extraScopes = @(if ($assessment.PSObject.Properties['ExtraScopes']) { $assessment.ExtraScopes })
        $extraWriteScopes = @(if ($assessment.PSObject.Properties['ExtraWriteScopes']) { $assessment.ExtraWriteScopes })

        [pscustomobject]@{
            SchemaVersion = '1.0'
            GeneratedAt   = [datetime]::UtcNow
            Tool          = [pscustomobject]@{
                Name    = 'CloudHarbor.M365SecurityInvestment'
                Version = $script:CHSIVersion
            }
            Tenant        = $tenant
            Config        = $config
            Inventory     = $inventory
            Spend         = $spend
            Realization   = $realization
            Provenance    = [pscustomobject]@{
                Source            = $Snapshot.Source
                SnapshotCollected = $Snapshot.GeneratedAt
                Scopes            = $scopes
                ExtraScopes       = $extraScopes
                ExtraWriteScopes  = $extraWriteScopes
                Collectors        = @($collectorSummary)
                Warnings          = @(Get-CHSIRunLog | Where-Object { $_.Level -in 'Warning', 'Error' } | Select-Object Level, Source, Message)
            }
        }
    }
}
