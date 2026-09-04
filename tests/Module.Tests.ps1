#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

BeforeAll {
    $script:ManifestPath = Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'CloudHarbor.M365SecurityInvestment.psd1' | Resolve-Path
    Import-Module $script:ManifestPath -Force
    $script:Manifest = Import-PowerShellDataFile -Path $script:ManifestPath
}

AfterAll {
    Remove-Module CloudHarbor.M365SecurityInvestment -Force -ErrorAction SilentlyContinue
}

Describe 'Module manifest' {

    It 'is a valid manifest' {
        { Test-ModuleManifest -Path $script:ManifestPath -ErrorAction Stop } | Should -Not -Throw
    }

    It 'requires PowerShell 7.4 or later' {
        [version]$script:Manifest.PowerShellVersion | Should -BeGreaterOrEqual ([version]'7.4')
    }

    It 'exports exactly the documented public surface' {
        $expected = @(
            'Connect-CHSITenant'
            'Disconnect-CHSITenant'
            'Test-CHSIPrerequisite'
            'Get-CHSISnapshot'
            'Invoke-CHSIAnalysis'
            'Export-CHSIReport'
            'New-CHSIReport'
        )
        $actual = @((Get-Command -Module CloudHarbor.M365SecurityInvestment).Name)
        $actual | Should -Be ($expected | Sort-Object) -Because 'the manifest and the module must agree'
    }

    It 'exports no private helper functions' {
        $exported = @((Get-Command -Module CloudHarbor.M365SecurityInvestment).Name)
        $exported | Should -Not -Contain 'Invoke-CHSIGraphRequest'
        $exported | Should -Not -Contain 'Resolve-CHSISku'
        $exported | Should -Not -Contain 'ConvertTo-CHSIHtml'
    }
}

Describe 'Public function contracts' {

    It '<Name> has comment-based help with a synopsis' -ForEach @(
        @{ Name = 'Connect-CHSITenant' }
        @{ Name = 'Disconnect-CHSITenant' }
        @{ Name = 'Test-CHSIPrerequisite' }
        @{ Name = 'Get-CHSISnapshot' }
        @{ Name = 'Invoke-CHSIAnalysis' }
        @{ Name = 'Export-CHSIReport' }
        @{ Name = 'New-CHSIReport' }
    ) {
        (Get-Help $Name).Synopsis | Should -Not -BeNullOrEmpty
    }

    It 'uses only approved PowerShell verbs' {
        foreach ($command in Get-Command -Module CloudHarbor.M365SecurityInvestment) {
            $command.Verb | Should -BeIn (Get-Verb).Verb -Because "$($command.Name) should use an approved verb"
        }
    }
}

Describe 'Shipped data files' {

    It '<File> is valid JSON' -ForEach @(
        @{ File = 'sku-catalog.json' }
        @{ File = 'pricelist.json' }
        @{ File = 'feature-map.json' }
        @{ File = 'risk-model.json' }
    ) {
        $path = Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'Data' $File
        { Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -Depth 20 } | Should -Not -Throw
    }

    It 'catalogs the Business Standard naming trap correctly' {
        $catalog = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'Data' 'sku-catalog.json') -Raw |
            ConvertFrom-Json -Depth 20

        $entry = $catalog.skus | Where-Object skuPartNumber -EQ 'O365_BUSINESS_PREMIUM'
        $entry.displayName | Should -Be 'Microsoft 365 Business Standard'
        $entry.trap | Should -Not -BeNullOrEmpty

        ($catalog.skus | Where-Object skuPartNumber -EQ 'SPB').displayName |
            Should -Be 'Microsoft 365 Business Premium'
    }

    It 'catalogs the SPE_F1 naming trap correctly' {
        $catalog = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'Data' 'sku-catalog.json') -Raw |
            ConvertFrom-Json -Depth 20

        ($catalog.skus | Where-Object skuPartNumber -EQ 'SPE_F1').displayName | Should -Be 'Microsoft 365 F3'
    }

    It 'has a price entry for every non-free catalog SKU that carries one' {
        $root = Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'Data'
        $catalog = Get-Content -LiteralPath (Join-Path $root 'sku-catalog.json') -Raw | ConvertFrom-Json -Depth 20
        $prices = Get-Content -LiteralPath (Join-Path $root 'pricelist.json') -Raw | ConvertFrom-Json -Depth 20

        $pricedPartNumbers = @($prices.prices.skuPartNumber)
        $catalogPartNumbers = @($catalog.skus.skuPartNumber)

        # Every priced SKU must exist in the catalog, or the report would show a bare part number.
        foreach ($partNumber in $pricedPartNumbers) {
            $catalogPartNumbers | Should -Contain $partNumber
        }
    }

    It 'never prices a SKU the catalog marks as free' {
        $root = Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'Data'
        $catalog = Get-Content -LiteralPath (Join-Path $root 'sku-catalog.json') -Raw | ConvertFrom-Json -Depth 20
        $prices = Get-Content -LiteralPath (Join-Path $root 'pricelist.json') -Raw | ConvertFrom-Json -Depth 20

        $freePartNumbers = @(($catalog.skus | Where-Object { $_.isFree }).skuPartNumber)
        foreach ($partNumber in @($prices.prices.skuPartNumber)) {
            $freePartNumbers | Should -Not -Contain $partNumber
        }
    }
}
