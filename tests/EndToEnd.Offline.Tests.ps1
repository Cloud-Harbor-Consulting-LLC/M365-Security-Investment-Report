#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

<#
    The primary regression gate: the whole pipeline, snapshot to rendered report, with no
    credentials and no network. Because analysis and rendering never touch Graph, this is
    genuine end-to-end coverage rather than a stub.
#>

BeforeAll {
    $manifest = Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'CloudHarbor.M365SecurityInvestment.psd1' | Resolve-Path
    Import-Module $manifest -Force

    $script:FixturePath = Join-Path $PSScriptRoot 'fixtures' 'premium-snapshot.json' | Resolve-Path
    $script:OutputPath = Join-Path ([System.IO.Path]::GetTempPath()) "chsi-e2e-$([guid]::NewGuid())"

    $script:Result = New-CHSIReport -FromSnapshot $script:FixturePath -OutputPath $script:OutputPath `
        -BaseName 'test-report' -PassThru -WarningAction SilentlyContinue

    $script:Report = $script:Result.Report
    $script:HtmlPath = Join-Path $script:OutputPath 'test-report.html'
    $script:Html = Get-Content -LiteralPath $script:HtmlPath -Raw
}

AfterAll {
    Remove-Item -LiteralPath $script:OutputPath -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Module CloudHarbor.M365SecurityInvestment -Force -ErrorAction SilentlyContinue
}

Describe 'Offline end-to-end run' {

    It 'produces all four output files' {
        foreach ($file in 'test-report.html', 'test-report.json', 'test-report-inventory.csv', 'test-report-summary.csv') {
            Join-Path $script:OutputPath $file | Should -Exist
        }
    }

    It 'runs with no Microsoft Graph connection' {
        # The fixture path must never require credentials; if it did, CI could not run it.
        $script:Report | Should -Not -BeNullOrEmpty
        $script:Report.Provenance.Source | Should -Be 'Graph'   # provenance of the *snapshot*, not of this run
    }
}

Describe 'Computed figures' {

    It 'counts seats across every billable SKU, priced or not' {
        $script:Report.Spend.SeatsPurchased | Should -Be 635
        $script:Report.Spend.SeatsConsumed | Should -Be 461
        $script:Report.Spend.SeatsUnassigned | Should -Be 174
    }

    It 'totals annual commitment from priced SKUs only' {
        # E5 120x684 + E3 300x432 + P1 50x72 + MDO P1 100x24 + Business Standard 25x150
        $script:Report.Spend.AnnualCommitment | Should -Be 221430
    }

    It 'totals spend in use from assigned seats' {
        $script:Report.Spend.AnnualSpendConsumed | Should -Be 194694
    }

    It 'totals idle seat cost as the difference' {
        $script:Report.Spend.UnassignedSeatCost | Should -Be 26736
        $script:Report.Spend.AnnualCommitment - $script:Report.Spend.AnnualSpendConsumed |
            Should -Be $script:Report.Spend.UnassignedSeatCost
    }

    It 'excludes both unlimited-seat free SKUs' {
        $script:Report.Spend.SkuCountExcluded | Should -Be 2
        @($script:Report.Inventory | Where-Object Excluded).SkuPartNumber |
            Should -Be @('POWER_BI_STANDARD', 'FLOW_FREE')
    }

    It 'flags the one unpriced SKU and marks the totals incomplete' {
        $script:Report.Spend.SkuCountUnpriced | Should -Be 1
        $script:Report.Spend.Complete | Should -BeFalse
        $script:Report.Spend.UnpricedSkus.SkuPartNumber | Should -Be 'CONTOSO_CUSTOM_ADDON'
    }

    It 'computes seat realization as assigned over purchased' {
        [Math]::Round($script:Report.Realization.Seat.Ratio, 4) | Should -Be 0.7260
    }
}

Describe 'Self-contained HTML' {

    It 'loads no external stylesheet, script, image or font' {
        # Text content may legitimately mention https URLs (Microsoft Learn links); what
        # must not appear is an attribute that would *fetch* something at view time.
        $script:Html | Should -Not -Match 'src\s*=\s*"https?:'
        $script:Html | Should -Not -Match '<link[^>]+href\s*=\s*"https?:'
        $script:Html | Should -Not -Match '<script[^>]+src'
        $script:Html | Should -Not -Match 'url\(\s*https?:'
        $script:Html | Should -Not -Match '@import'
    }

    It 'embeds the brand typeface as a data URI' {
        $script:Html | Should -Match "font-family:\s*'Lato'"
        $script:Html | Should -Match 'url\(data:font/ttf;base64,'
    }

    It 'inlines the Cloud Harbor logo as SVG that inherits currentColor' {
        $script:Html | Should -Match 'class="ch-logo"'
        $script:Html | Should -Match 'fill="currentColor"'
    }

    It 'renders all three audience layers' {
        $script:Html | Should -Match 'Board one-pager'
        $script:Html | Should -Match 'Executive summary'
        $script:Html | Should -Match 'Architect appendix'
    }

    It 'states the pricing basis prominently' {
        $script:Html | Should -Match 'Pricing basis'
        $script:Html | Should -Match 'Microsoft public list price'
    }

    It 'carries the read-only trust statement' {
        $script:Html | Should -Match 'GET requests exclusively'
    }

    It 'shows the naming trap on Business Standard' {
        $script:Html | Should -Match 'Microsoft 365 Business Standard'
        $script:Html | Should -Match 'naming trap'
    }

    It 'says feature realization is not measured rather than showing a zero' {
        $script:Html | Should -Match 'Not yet measured'
        $script:Html | Should -Not -Match 'Spend realized</div>\s*<div class="ch-tile-value">0%'
    }

    It 'lists every SKU in the inventory table' {
        foreach ($partNumber in 'SPE_E5', 'SPE_E3', 'AAD_PREMIUM', 'ATP_ENTERPRISE',
                                'O365_BUSINESS_PREMIUM', 'CONTOSO_CUSTOM_ADDON',
                                'POWER_BI_STANDARD', 'FLOW_FREE') {
            $script:Html | Should -Match ([regex]::Escape("<code>$partNumber</code>"))
        }
    }

    It 'renders the gauge at the computed percentage, not a rounded whole' {
        # Regression: integer literals in Math::Min once rounded 72.6% up to 100%.
        $script:Html | Should -Match '<text class="ch-gauge-centre"[^>]*>73%</text>'
    }

    It 'is a single file under 1 MB' {
        (Get-Item -LiteralPath $script:HtmlPath).Length | Should -BeLessThan 1MB
    }
}

Describe 'Data exports' {

    It 'produces JSON carrying the same totals as the HTML' {
        $json = Get-Content -LiteralPath (Join-Path $script:OutputPath 'test-report.json') -Raw | ConvertFrom-Json -Depth 20
        $json.Spend.AnnualCommitment | Should -Be 221430
        $json.Inventory.Count | Should -Be 8
    }

    It 'produces an inventory CSV with one row per SKU' {
        $csv = Import-Csv -LiteralPath (Join-Path $script:OutputPath 'test-report-inventory.csv')
        $csv.Count | Should -Be 8
        $csv[0].PSObject.Properties.Name | Should -Contain 'IdleSeatCost'
        $csv[0].PSObject.Properties.Name | Should -Contain 'PricingBasis'
    }

    It 'produces a one-row tenant summary CSV' {
        $csv = @(Import-Csv -LiteralPath (Join-Path $script:OutputPath 'test-report-summary.csv'))
        $csv.Count | Should -Be 1
        $csv[0].SeatsPurchased | Should -Be '635'
        $csv[0].DollarFiguresComplete | Should -Be 'False'
    }

    It 'leaves unpriced money columns empty rather than zero in the CSV' {
        $csv = Import-Csv -LiteralPath (Join-Path $script:OutputPath 'test-report-inventory.csv')
        $row = $csv | Where-Object SkuPartNumber -EQ 'CONTOSO_CUSTOM_ADDON'
        $row.AnnualCommitment | Should -BeNullOrEmpty
        $row.AssignedSeats | Should -Be '40'
    }
}
