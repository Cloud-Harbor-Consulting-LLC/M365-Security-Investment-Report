#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

<#
    Regression coverage for the tenant shape where NOT ONE SKU can be priced.

    The first live run against a real tenant produced this board sentence:

        "This tenant carries $0 a year in Microsoft 365 licence commitment,
         with every purchased seat assigned."

    for a tenant with 27 purchased seats, 26 of them unassigned. Two defects combined:
    summing an empty set of priced SKUs to 0.00 and presenting it as a fact, and branching
    a claim about *seats* on a *dollar* figure. Both are the precise failure this tool
    exists to prevent, so they are pinned here.
#>

BeforeAll {
    $manifest = Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'CloudHarbor.M365SecurityInvestment.psd1' | Resolve-Path
    Import-Module $manifest -Force

    $script:OutputPath = Join-Path ([System.IO.Path]::GetTempPath()) "chsi-unpriced-$([guid]::NewGuid())"
    $fixture = Join-Path $PSScriptRoot 'fixtures' 'unpriced-snapshot.json' | Resolve-Path

    $script:Result = New-CHSIReport -FromSnapshot $fixture -OutputPath $script:OutputPath `
        -BaseName 'unpriced' -PassThru -WarningAction SilentlyContinue
    $script:Report = $script:Result.Report
    $script:Html = Get-Content -LiteralPath (Join-Path $script:OutputPath 'unpriced.html') -Raw

    $lede = [regex]::Match($script:Html, '<p class="ch-lede">(.*?)</p>', 'Singleline')
    $script:Lede = ([regex]::Replace($lede.Groups[1].Value, '<[^>]+>', '') -split '\s+') -join ' '
}

AfterAll {
    Remove-Item -LiteralPath $script:OutputPath -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Module CloudHarbor.M365SecurityInvestment -Force -ErrorAction SilentlyContinue
}

Describe 'A tenant where nothing can be priced' {

    It 'still produces a report rather than failing' {
        $script:Report | Should -Not -BeNullOrEmpty
    }

    It 'reports that no SKU was priced' {
        $script:Report.Spend.AnyPriced | Should -BeFalse
        $script:Report.Spend.SkuCountPriced | Should -Be 0
        $script:Report.Spend.Complete | Should -BeFalse
    }

    It 'leaves every dollar total unknown instead of zero' {
        # $0 is a claim about the tenant. Null is the truth: we could not price it.
        $script:Report.Spend.AnnualCommitment | Should -BeNullOrEmpty
        $script:Report.Spend.AnnualSpendConsumed | Should -BeNullOrEmpty
        $script:Report.Spend.UnassignedSeatCost | Should -BeNullOrEmpty
        $script:Report.Spend.MonthlySpendConsumed | Should -BeNullOrEmpty
    }

    It 'still counts seats accurately across billable SKUs' {
        # PREVIEW_SKU_NOT_IN_CATALOG 1 + ANOTHER_PREVIEW_ADDON 25 + RMSBASIC excluded (free)
        $script:Report.Spend.SeatsPurchased | Should -Be 26
        $script:Report.Spend.SeatsConsumed | Should -Be 1
        $script:Report.Spend.SeatsUnassigned | Should -Be 25
    }

    It 'excludes the free and unlimited-seat SKUs' {
        @($script:Report.Inventory | Where-Object Excluded).SkuPartNumber |
            Should -Contain 'FLOW_FREE'
        @($script:Report.Inventory | Where-Object Excluded).SkuPartNumber |
            Should -Contain 'TVM_Premium_Add_on'
        @($script:Report.Inventory | Where-Object Excluded).SkuPartNumber |
            Should -Contain 'RMSBASIC'
    }
}

Describe 'The board lede tells the truth' {

    It 'never claims every seat is assigned when seats are idle' {
        $script:Lede | Should -Not -Match 'every purchased seat assigned'
    }

    It 'never presents an unknown cost as a dollar amount' {
        $script:Lede | Should -Not -Match '\$0'
    }

    It 'says plainly that no spend figure could be produced' {
        $script:Lede | Should -Match 'could not be priced|no spend figure'
    }

    It 'states the real seat position' {
        $script:Lede | Should -Match '25 of its 26 purchased seats are not assigned'
    }
}

Describe 'The board tiles tell the truth' {

    It 'renders money tiles as not available rather than $0' {
        $script:Html | Should -Match 'Annual licence commitment</div>\s*<div class="ch-tile-value ch-tile-value--unavailable">Not available</div>'
        $script:Html | Should -Not -Match 'ch-tile-value">\$0</div>'
    }

    It 'still shows the true seat counts on those tiles' {
        $script:Html | Should -Match '25 unassigned seats'
        $script:Html | Should -Match '26 purchased seats'
    }

    It 'names the unpriced SKUs so the gap is closable' {
        $script:Html | Should -Match 'PREVIEW_SKU_NOT_IN_CATALOG'
        $script:Html | Should -Match 'ANOTHER_PREVIEW_ADDON'
    }
}

Describe 'Scope disclosure' {

    It 'discloses session scopes beyond what the tool requests' {
        $script:Report.Provenance.ExtraScopes | Should -Contain 'Sites.Read.All'
        $script:Report.Provenance.ExtraScopes | Should -Contain 'DelegatedPermissionGrant.ReadWrite.All'
    }

    It 'singles out write scopes present in the session' {
        $script:Report.Provenance.ExtraWriteScopes | Should -Contain 'DelegatedPermissionGrant.ReadWrite.All'
    }

    It 'does not flag standard OIDC scopes as extra' {
        $script:Report.Provenance.ExtraScopes | Should -Not -Contain 'openid'
        $script:Report.Provenance.ExtraScopes | Should -Not -Contain 'profile'
    }

    It 'surfaces the disclosure in the report itself' {
        $script:Html | Should -Match 'beyond what this tool requests'
        $script:Html | Should -Match 'grant write access'
    }
}
