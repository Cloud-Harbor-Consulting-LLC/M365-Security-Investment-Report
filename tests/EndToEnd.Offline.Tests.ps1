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
        # Per seat per year: E5 120x720 + E3 300x468 + Entra P1 50x84 + MDO P1 100x24
        # + Business Standard 25x168. All but MDO P1 rose on 1 July 2026.
        $script:Report.Spend.AnnualCommitment | Should -Be 237600
    }

    It 'totals spend in use from assigned seats' {
        $script:Report.Spend.AnnualSpendConsumed | Should -Be 209112
    }

    It 'totals idle seat cost as the difference' {
        $script:Report.Spend.UnassignedSeatCost | Should -Be 28488
        $script:Report.Spend.AnnualCommitment - $script:Report.Spend.AnnualSpendConsumed |
            Should -Be $script:Report.Spend.UnassignedSeatCost
    }

    It 'totals the security budget from assigned seats and each SKU''s share' {
        # Mirrors the parity test in app/src/engine/parity.test.ts. Assigned seats x annual
        # price x securityValueShare: 27,648 + 21,565.44 + 1,008 + 0 + 294.
        [math]::Round($script:Report.Spend.SecurityBudgetAnnual, 2) | Should -Be 50515.44
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

    It 'embeds the typeface as a data URI' {
        $script:Html | Should -Match "font-family:\s*'Lato'"
        $script:Html | Should -Match 'url\(data:font/ttf;base64,'
    }

    It 'keeps the project palette' {
        foreach ($hex in '#269CDD', '#7DCFF6', '#222121') {
            $script:Html | Should -Match ([regex]::Escape($hex))
        }
    }

    It 'ships no logo, wordmark or vendor attribution' {
        # Open source and forkable: a trademark travelling with every fork serves nobody.
        # The palette and typeface carry the identity instead.
        $script:Html | Should -Not -Match 'ch-logo'
        $script:Html | Should -Not -Match 'rel="icon"'
        $script:Html | Should -Not -Match 'Cloud Harbor Consulting'
        $script:Html | Should -Not -Match '<svg[^>]*aria-label="Cloud Harbor'
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

    It 'points to the browser app for what it does not analyse, rather than promising it' {
        # The analysis beyond spend lives in the app by design. Milestone tags from the
        # v1.0 build read as a promise this report will never keep.
        $script:Html | Should -Match 'The rest of the analysis is in the browser app'
        $script:Html | Should -Match 'href="https://cloud-harbor-consulting-llc\.github\.io/M365-Security-Investment-Report/"'
        $script:Html | Should -Not -Match 'Still to come|milestone M\d|\(M\d\)'
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
        $json.Spend.AnnualCommitment | Should -Be 237600
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

Describe 'The committed samples still describe this build' {
    # samples/ holds a generated report so someone evaluating the tool can see the export
    # format without running anything. Nothing imports it, nothing tests it, and it sat for
    # months showing a tool version and a licence total that had both moved on. A sample
    # that contradicts the tool is worse than no sample, because it is the first thing a
    # finance reader opens.
    #
    # Regenerate with:
    #   New-CHSIReport -FromSnapshot ./tests/fixtures/premium-snapshot.json `
    #                  -OutputPath ./samples -BaseName sample-report -Format Html,Json,Csv

    BeforeAll {
        $script:SamplesRoot = Join-Path $PSScriptRoot '..'
        $script:SampleSummary = Import-Csv -LiteralPath (
            Join-Path $script:SamplesRoot 'samples/sample-report-summary.csv')
        $script:Manifest = Import-PowerShellDataFile -LiteralPath (
            Join-Path $script:SamplesRoot 'src/CloudHarbor.M365SecurityInvestment/CloudHarbor.M365SecurityInvestment.psd1')
        $script:PriceList = Get-Content -LiteralPath (
            Join-Path $script:SamplesRoot 'src/CloudHarbor.M365SecurityInvestment/Data/pricelist.json') -Raw |
            ConvertFrom-Json
    }

    It 'was generated by the current module version' {
        $script:SampleSummary[0].ToolVersion | Should -Be $script:Manifest.ModuleVersion
    }

    It 'was generated against the current price table' {
        # The pricing basis string carries the table's asOf, so a price sweep that does not
        # regenerate the samples fails here rather than shipping contradictory figures.
        $script:SampleSummary[0].PricingBasis | Should -BeLike "*$($script:PriceList.asOf)*"
    }

    It 'carries the same totals the engine produces from the same fixture' {
        $script:SampleSummary[0].AnnualCommitment | Should -Be '237600'
        $script:SampleSummary[0].SeatsPurchased | Should -Be '635'
        # A share change moves only this column, so it is the one that proves the samples
        # were regenerated after one.
        $script:SampleSummary[0].SecurityBudgetAnnual | Should -Be '50515.44'
    }
}

Describe 'CSV money is written to the cent' {
    # Mirrors the precision test in app/src/engine/export.test.ts. The shipped prices are
    # whole dollars, so the sample exports look clean and prove nothing. A real price such
    # as 8.55 does not: 8.55 x 12 is 102.60000000000001 in binary, and ConvertTo-Csv writes
    # a double at full round-trip precision, which is how an older sample of this export
    # came to show 18662.399999999998.
    BeforeAll {
        $script:Csv = InModuleScope CloudHarbor.M365SecurityInvestment {
            $annual = 8.55 * 12
            $priced = [pscustomobject]@{
                SkuPartNumber = 'SPE_E3'; DisplayName = 'Microsoft 365 E3'; Family = 'Microsoft 365'; SkuId = 'e3'
                PurchasedUnits = 300; ConsumedUnits = 288; UnassignedUnits = 12; SeatUtilization = 0.96
                UnitPriceMonthly = 8.55; UnitPriceAnnual = $annual
                AnnualCommitment = $annual * 300; AnnualSpendConsumed = $annual * 288
                UnassignedSeatCost = $annual * 12; SecurityValueShare = 0.16
                SecurityBudgetAnnual = $annual * 288 * 0.16
                PriceKnown = $true; Excluded = $false; ExclusionReason = $null; NamingTrap = $null
            }
            $unpriced = [pscustomobject]@{
                SkuPartNumber = 'CONTOSO_CUSTOM_ADDON'; DisplayName = 'Add-on'; Family = 'Other'; SkuId = 'x'
                PurchasedUnits = 40; ConsumedUnits = 40; UnassignedUnits = 0; SeatUtilization = 1
                UnitPriceMonthly = $null; UnitPriceAnnual = $null
                AnnualCommitment = $null; AnnualSpendConsumed = $null
                UnassignedSeatCost = $null; SecurityValueShare = 0.1; SecurityBudgetAnnual = $null
                PriceKnown = $false; Excluded = $false; ExclusionReason = $null; NamingTrap = $null
            }
            $report = [pscustomobject]@{
                Tenant      = [pscustomobject]@{ TenantId = 't'; DisplayName = 'Contoso Ltd'; DefaultDomain = 'contoso.com' }
                GeneratedAt = '2026-10-24T00:00:00Z'
                Tool        = [pscustomobject]@{ Version = '1.0.0' }
                Spend       = [pscustomobject]@{
                    Currency = 'USD'; BasisLabel = 'list'; PricingVerified = $false
                    SeatsPurchased = 340; SeatsConsumed = 328; SeatsUnassigned = 12
                    AnnualCommitment = $annual * 300; AnnualSpendConsumed = $annual * 288
                    UnassignedSeatCost = $annual * 12; SecurityBudgetAnnual = $annual * 288 * 0.16
                    SkuCountTotal = 2; SkuCountPriced = 1; SkuCountUnpriced = 1; SkuCountExcluded = 0
                    Complete = $false
                }
                Realization = [pscustomobject]@{ Seat = [pscustomobject]@{ Ratio = 0.9647058823529412 } }
                Inventory   = @($priced, $unpriced)
            }
            [pscustomobject]@{
                RawCommitment = ($annual * 300).ToString('R', [cultureinfo]::InvariantCulture)
                Inventory     = @(ConvertTo-CHSIInventoryCsvRow -Report $report) | ConvertTo-Csv -NoTypeInformation | ConvertFrom-Csv
                Summary       = @(ConvertTo-CHSISummaryCsvRow -Report $report) | ConvertTo-Csv -NoTypeInformation | ConvertFrom-Csv
            }
        }
        $script:Money = 'UnitPriceMonthly', 'UnitPriceAnnual', 'AnnualCommitment', 'AnnualSpendAssigned',
            'IdleSeatCost', 'SecurityBudgetAnnual'
    }

    It 'starts from figures that genuinely carry binary noise' {
        # Otherwise the next test could pass by never meeting the problem.
        $script:Csv.RawCommitment | Should -Match '\.\d{3,}$'
    }

    It 'writes every money column to the cent' {
        foreach ($row in @($script:Csv.Inventory) + @($script:Csv.Summary)) {
            foreach ($column in $script:Money) {
                if ($row.PSObject.Properties.Name -notcontains $column) { continue }
                if ($row.$column -eq '') { continue }
                $row.$column | Should -Match '^\d+(\.\d{1,2})?$' -Because "$column wrote $($row.$column)"
            }
        }
    }

    It 'leaves an unknown figure empty rather than zero' {
        $addon = $script:Csv.Inventory | Where-Object SkuPartNumber -EQ 'CONTOSO_CUSTOM_ADDON'
        foreach ($column in $script:Money) { $addon.$column | Should -BeNullOrEmpty -Because $column }
    }
}
