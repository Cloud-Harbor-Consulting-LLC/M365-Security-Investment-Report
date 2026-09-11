#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

BeforeAll {
    $manifest = Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'CloudHarbor.M365SecurityInvestment.psd1' | Resolve-Path
    Import-Module $manifest -Force
}

AfterAll {
    Remove-Module CloudHarbor.M365SecurityInvestment -Force -ErrorAction SilentlyContinue
}

Describe 'Safe division' {

    It 'returns null rather than zero when nothing was purchased' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            # "No seats purchased" and "0% realized" mean different things to a reader.
            ConvertTo-CHSISafeRatio 0 0 | Should -BeNullOrEmpty
        }
    }

    It 'divides normally' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            ConvertTo-CHSISafeRatio 461 635 | Should -BeGreaterThan 0.72
            ConvertTo-CHSISafeRatio 461 635 | Should -BeLessThan 0.73
        }
    }
}

Describe 'Value formatting' {

    It 'renders a null figure as n/a, never as zero' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            Format-CHSICurrency $null | Should -Be 'n/a'
            Format-CHSIPercent $null | Should -Be 'n/a'
        }
    }

    It 'formats currency with a thousands separator' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            Format-CHSICurrency 221430 -Currency 'USD' | Should -Be '$221,430'
        }
    }

    It 'formats a ratio as a whole percentage' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            Format-CHSIPercent 0.726 | Should -Be '73%'
        }
    }
}

Describe 'Resolve-CHSISku' {

    It 'resolves the Business Standard naming trap to the correct product name' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            $config = Get-CHSIDefaultConfig
            $sku = [pscustomobject]@{
                SkuId = 'x'; SkuPartNumber = 'O365_BUSINESS_PREMIUM'; AppliesTo = 'User'
                CapabilityStatus = 'Enabled'; ConsumedUnits = 25; PrepaidEnabled = 25
                PrepaidSuspended = 0; PrepaidWarning = 0; ServicePlans = @()
            }

            $result = Resolve-CHSISku -Sku @($sku) -Config $config
            $result.DisplayName | Should -Be 'Microsoft 365 Business Standard'
            $result.NamingTrap | Should -Not -BeNullOrEmpty
        }
    }

    It 'excludes free SKUs that report unlimited seat counts' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            $config = Get-CHSIDefaultConfig
            $sku = [pscustomobject]@{
                SkuId = 'x'; SkuPartNumber = 'POWER_BI_STANDARD'; AppliesTo = 'User'
                CapabilityStatus = 'Enabled'; ConsumedUnits = 143; PrepaidEnabled = 1000000
                PrepaidSuspended = 0; PrepaidWarning = 0; ServicePlans = @()
            }

            $result = Resolve-CHSISku -Sku @($sku) -Config $config
            $result.Excluded | Should -BeTrue
            $result.ExclusionReason | Should -Not -BeNullOrEmpty
            $result.AnnualCommitment | Should -BeNullOrEmpty
        }
    }

    It 'excludes an unrecognized SKU that reports an unlimited seat count' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            # Not in the catalog, so the seat-count heuristic is the only defence.
            $config = Get-CHSIDefaultConfig
            $sku = [pscustomobject]@{
                SkuId = 'x'; SkuPartNumber = 'SOME_UNKNOWN_VIRAL_TRIAL'; AppliesTo = 'User'
                CapabilityStatus = 'Enabled'; ConsumedUnits = 5; PrepaidEnabled = 10000
                PrepaidSuspended = 0; PrepaidWarning = 0; ServicePlans = @()
            }

            $result = Resolve-CHSISku -Sku @($sku) -Config $config
            $result.Excluded | Should -BeTrue
            $result.IsUnlimitedSeatCount | Should -BeTrue
        }
    }

    It 'marks a SKU with no price entry rather than pricing it at zero' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            $config = Get-CHSIDefaultConfig
            $sku = [pscustomobject]@{
                SkuId = 'x'; SkuPartNumber = 'CONTOSO_CUSTOM_ADDON'; AppliesTo = 'User'
                CapabilityStatus = 'Enabled'; ConsumedUnits = 40; PrepaidEnabled = 40
                PrepaidSuspended = 0; PrepaidWarning = 0; ServicePlans = @()
            }

            $result = Resolve-CHSISku -Sku @($sku) -Config $config -WarningAction SilentlyContinue
            $result.PriceKnown | Should -BeFalse
            $result.AnnualCommitment | Should -BeNullOrEmpty
            $result.UnassignedSeatCost | Should -BeNullOrEmpty
            $result.ConsumedUnits | Should -Be 40   # still counted in seats
        }
    }

    It 'computes annual commitment, spend in use and idle cost from the monthly unit price' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            $config = Get-CHSIDefaultConfig
            $sku = [pscustomobject]@{
                SkuId = 'x'; SkuPartNumber = 'SPE_E5'; AppliesTo = 'User'
                CapabilityStatus = 'Enabled'; ConsumedUnits = 96; PrepaidEnabled = 120
                PrepaidSuspended = 0; PrepaidWarning = 0; ServicePlans = @()
            }

            $result = Resolve-CHSISku -Sku @($sku) -Config $config
            $annualUnit = $result.UnitPriceMonthly * 12

            $result.AnnualCommitment | Should -Be ($annualUnit * 120)
            $result.AnnualSpendConsumed | Should -Be ($annualUnit * 96)
            $result.UnassignedSeatCost | Should -Be ($annualUnit * 24)
            $result.UnassignedUnits | Should -Be 24
        }
    }

    It 'honours a manual exclusion from configuration' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            $config = Get-CHSIDefaultConfig
            $config.skus.excludeSkuPartNumbers = @('SPE_E3')
            $sku = [pscustomobject]@{
                SkuId = 'x'; SkuPartNumber = 'SPE_E3'; AppliesTo = 'User'
                CapabilityStatus = 'Enabled'; ConsumedUnits = 10; PrepaidEnabled = 10
                PrepaidSuspended = 0; PrepaidWarning = 0; ServicePlans = @()
            }

            $result = Resolve-CHSISku -Sku @($sku) -Config $config
            $result.Excluded | Should -BeTrue
            $result.ExclusionReason | Should -Be 'Excluded by configuration.'
        }
    }
}

Describe 'Measure-CHSISpend' {

    It 'counts unpriced seats but keeps their cost out of every dollar total' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            $config = Get-CHSIDefaultConfig
            $skus = @(
                [pscustomobject]@{
                    SkuId = 'a'; SkuPartNumber = 'SPE_E5'; AppliesTo = 'User'; CapabilityStatus = 'Enabled'
                    ConsumedUnits = 10; PrepaidEnabled = 10; PrepaidSuspended = 0; PrepaidWarning = 0; ServicePlans = @()
                }
                [pscustomobject]@{
                    SkuId = 'b'; SkuPartNumber = 'MYSTERY_SKU'; AppliesTo = 'User'; CapabilityStatus = 'Enabled'
                    ConsumedUnits = 40; PrepaidEnabled = 40; PrepaidSuspended = 0; PrepaidWarning = 0; ServicePlans = @()
                }
            )

            $inventory = @(Resolve-CHSISku -Sku $skus -Config $config -WarningAction SilentlyContinue)
            $spend = Measure-CHSISpend -Inventory $inventory -Config $config

            $spend.SeatsPurchased | Should -Be 50           # both SKUs counted
            $spend.AnnualCommitment | Should -Be (60.00 * 12 * 10)  # only the priced one
            $spend.SkuCountUnpriced | Should -Be 1
            $spend.Complete | Should -BeFalse               # totals are a floor, and say so
        }
    }

    It 'keeps excluded free SKUs out of seat and dollar totals alike' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            $config = Get-CHSIDefaultConfig
            $skus = @(
                [pscustomobject]@{
                    SkuId = 'a'; SkuPartNumber = 'SPE_E3'; AppliesTo = 'User'; CapabilityStatus = 'Enabled'
                    ConsumedUnits = 100; PrepaidEnabled = 100; PrepaidSuspended = 0; PrepaidWarning = 0; ServicePlans = @()
                }
                [pscustomobject]@{
                    SkuId = 'b'; SkuPartNumber = 'FLOW_FREE'; AppliesTo = 'User'; CapabilityStatus = 'Enabled'
                    ConsumedUnits = 88; PrepaidEnabled = 10000; PrepaidSuspended = 0; PrepaidWarning = 0; ServicePlans = @()
                }
            )

            $inventory = @(Resolve-CHSISku -Sku $skus -Config $config)
            $spend = Measure-CHSISpend -Inventory $inventory -Config $config

            $spend.SeatsPurchased | Should -Be 100
            $spend.SkuCountExcluded | Should -Be 1
        }
    }

    It 'reports the pricing basis so a CFO can see which numbers these are' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            $config = Get-CHSIDefaultConfig
            $spend = Measure-CHSISpend -Inventory @() -Config $config

            $spend.BasisLabel | Should -Match 'Microsoft public list price'
            $spend.BasisLabel | Should -Match 'unverified'
            $spend.PricingVerified | Should -BeFalse
        }
    }
}

Describe 'Spend realization' {

    It 'reports the seat component and withholds the composite until features are measured' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            $config = Get-CHSIDefaultConfig
            $sku = [pscustomobject]@{
                SkuId = 'a'; SkuPartNumber = 'SPE_E5'; AppliesTo = 'User'; CapabilityStatus = 'Enabled'
                ConsumedUnits = 96; PrepaidEnabled = 120; PrepaidSuspended = 0; PrepaidWarning = 0; ServicePlans = @()
            }

            $inventory = @(Resolve-CHSISku -Sku @($sku) -Config $config)
            $spend = Measure-CHSISpend -Inventory $inventory -Config $config
            $realization = Measure-CHSISpendRealization -Spend $spend

            $realization.Seat.Available | Should -BeTrue
            $realization.Seat.Ratio | Should -Be 0.8

            # Reporting a seat-only figure as "spend realized" would overstate the tenant.
            $realization.Feature.Available | Should -BeFalse
            $realization.Composite.Available | Should -BeFalse
            $realization.Composite.Ratio | Should -BeNullOrEmpty
        }
    }
}

Describe 'Configuration merge' {

    It 'layers a partial config file over the defaults without dropping the rest' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) "chsi-config-$([guid]::NewGuid()).json"
            '{ "inactivity": { "thresholdDays": 45 } }' | Set-Content -LiteralPath $path -Encoding utf8

            try {
                $config = Import-CHSIConfig -Path $path
                $config.inactivity.thresholdDays | Should -Be 45
                $config.pricing.currency | Should -Be 'USD'          # default survives
                $config.skus.unlimitedSeatThreshold | Should -Be 100000
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Describe 'Scope assessment' {

    It 'treats a missing optional scope as degradation, not failure' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            $assessment = Assert-CHSIScope -GrantedScope @(
                'Organization.Read.All', 'Directory.Read.All', 'User.Read.All'
            ) -WarningAction SilentlyContinue

            $assessment.Satisfied | Should -BeTrue
            $assessment.MissingOptional | Should -Contain 'AuditLog.Read.All'
            $assessment.MissingOptional | Should -Contain 'SecurityEvents.Read.All'
        }
    }

    It 'fails when a required scope is absent' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            $assessment = Assert-CHSIScope -GrantedScope @('User.Read.All') -WarningAction SilentlyContinue
            $assessment.Satisfied | Should -BeFalse
            $assessment.MissingRequired | Should -Contain 'Organization.Read.All'

            { Assert-CHSIScope -GrantedScope @('User.Read.All') -ThrowOnMissingRequired -WarningAction SilentlyContinue } |
                Should -Throw -ExpectedMessage '*Missing required read-only scope*'
        }
    }

    It 'requests only read-only scopes' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            foreach ($scope in (Get-CHSIRequiredScope).Scope) {
                $scope | Should -Match '\.Read(\.All)?$' -Because 'this tool must never request a write scope'
            }
        }
    }
}

Describe 'SKU name resolution' {
    It 'resolves the part numbers Microsoft publishes, not just our curated ones' {
        # The complaint that produced this: the Product column showed raw part numbers.
        $catalog = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'Data' 'sku-catalog.json') -Raw |
            ConvertFrom-Json -Depth 20
        $catalog.skus.Count | Should -BeGreaterThan 600
        ($catalog.skus | Where-Object skuPartNumber -EQ 'MDATP_XPLAT').displayName |
            Should -Be 'Microsoft Defender for Endpoint P2'
    }

    It 'gives every catalog entry a GUID, which is the stable identifier' {
        $catalog = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'Data' 'sku-catalog.json') -Raw |
            ConvertFrom-Json -Depth 20
        $official = @($catalog.skus | Where-Object { $_.source -eq 'microsoft' })
        @($official | Where-Object { -not $_.skuId }).Count | Should -Be 0
    }

    It 'leaves no internal suffix or stray whitespace in the shipped catalog' {
        # Microsoft's own display names carry markers like _XPLAT and _HUB, and several
        # part numbers arrive padded with spaces or a tab. Both would surface in a column
        # headed Product, or silently break an exact-match lookup.
        $catalog = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'Data' 'sku-catalog.json') -Raw |
            ConvertFrom-Json -Depth 20
        @($catalog.skus | Where-Object { $_.displayName -match '_' }).Count | Should -Be 0
        @($catalog.skus | Where-Object { $_.skuPartNumber -ne $_.skuPartNumber.Trim() }).Count | Should -Be 0
    }

    It 'keeps sovereign-cloud markers, which are different products' {
        $catalog = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'Data' 'sku-catalog.json') -Raw |
            ConvertFrom-Json -Depth 20
        ($catalog.skus | Where-Object skuPartNumber -EQ 'SPE_E3_USGOV_GCCHIGH').displayName |
            Should -Be 'Microsoft 365 E3 (GCC High)'
    }

    It 'renders an unpublished part number identically to the browser tier' {
        # Both tiers must name the same product for the same tenant. These expectations
        # are duplicated verbatim in app/src/engine/inventory.test.ts; if one tier changes
        # its formatting, one of the two suites fails.
        InModuleScope CloudHarbor.M365SecurityInvestment {
            ConvertTo-CHSIFriendlySkuName -PartNumber 'MICROSOFT_AGENT_365_TIER_3' |
                Should -Be 'Microsoft Agent 365 Tier 3'
            ConvertTo-CHSIFriendlySkuName -PartNumber 'Dynamics_365_Business_Central_Partner_Sandbox' |
                Should -Be 'Dynamics 365 Business Central Partner Sandbox'
            ConvertTo-CHSIFriendlySkuName -PartNumber 'POWERAUTOMATE_ATTENDED_RPA' |
                Should -Be 'Powerautomate Attended RPA'
            ConvertTo-CHSIFriendlySkuName -PartNumber 'Microsoft_365_Copilot' |
                Should -Be 'Microsoft 365 Copilot'
            ConvertTo-CHSIFriendlySkuName -PartNumber 'SOME_FUTURE_SKU_TIER_9' |
                Should -Be 'Some Future SKU Tier 9'
        }
    }
}

Describe 'Secure Score collector, offline' {
    # The collectors only ever ran against live Graph, so a runtime error in one reached a
    # customer tenant: [bool](if ...) parses as a call to a command named 'if' and fails
    # only when the line executes. Mocking the Graph helper exercises the whole shaping
    # path offline, which is where that class of defect belongs.

    It 'shapes profiles and scores without touching the network' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            Mock Invoke-CHSIGraphRequest {
                if ($Uri -like '*secureScores*') {
                    return @(
                        @{
                            createdDateTime = '2026-09-01T00:00:00Z'
                            currentScore    = 42.5
                            maxScore        = 100
                            averageComparativeScores = @(
                                @{ basis = 'AllTenants'; averageScore = 38.0 }
                            )
                            controlScores   = @(
                                @{ controlName = 'AdminMFAV2'; score = 4.5; controlCategory = 'Identity'; description = 'x'; scoreInPercentage = 45 }
                            )
                        }
                    )
                }
                return @(
                    @{
                        id = 'AdminMFAV2'; title = 'Require MFA for admins'; maxScore = 10
                        service = 'AzureAD'; tier = 'Core'; rank = 1
                        remediation = '<p>Do the thing</p>'; implementationCost = 'Low'; userImpact = 'Low'
                        actionUrl = 'https://security.microsoft.com/securescore'
                        threats = @('accountBreach', 'elevationOfPrivilege')
                        controlCategory = 'Identity'
                        deprecated = $false
                    }
                )
            }

            $result = Get-CHSISecureScoreData
            $result.Available | Should -BeTrue

            $scoreProfile = $result.Data.ControlProfiles | Select-Object -First 1
            $scoreProfile.ControlName | Should -Be 'AdminMFAV2'
            $scoreProfile.MaxScore | Should -Be 10
            # The three fields M7c added, and the one that failed at runtime.
            $scoreProfile.Threats | Should -Contain 'accountBreach'
            $scoreProfile.ControlCategory | Should -Be 'Identity'
            $scoreProfile.Deprecated | Should -BeFalse

            $result.Data.CurrentScore | Should -Be 42.5
            ($result.Data.ControlScores | Select-Object -First 1).Score | Should -Be 4.5
        }
    }

    It 'defaults the new fields when Graph omits them' {
        InModuleScope CloudHarbor.M365SecurityInvestment {
            Mock Invoke-CHSIGraphRequest {
                if ($Uri -like '*secureScores*') {
                    return @(
                        @{ createdDateTime = '2026-09-01T00:00:00Z'; currentScore = 1; maxScore = 10
                           averageComparativeScores = @(); controlScores = @() }
                    )
                }
                # An older tenant, or a control Microsoft has not tagged.
                return @(@{ id = 'Bare'; maxScore = 5 })
            }

            $scoreProfile = (Get-CHSISecureScoreData).Data.ControlProfiles | Select-Object -First 1
            @($scoreProfile.Threats).Count | Should -Be 0
            $scoreProfile.ControlCategory | Should -BeNullOrEmpty
            $scoreProfile.Deprecated | Should -BeFalse
        }
    }
}
