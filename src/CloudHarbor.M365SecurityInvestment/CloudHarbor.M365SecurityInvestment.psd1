@{
    RootModule           = 'CloudHarbor.M365SecurityInvestment.psm1'
    ModuleVersion        = '0.1.0'
    GUID                 = 'b7c4e1a8-3f92-4d5e-9a61-8c2d7e4f0b13'
    Author               = 'Derek Morgan'
    CompanyName          = 'Cloud Harbor Consulting LLC'
    Copyright            = '(c) Cloud Harbor Consulting LLC. Licensed under the MIT License.'
    Description          = 'Read-only Microsoft 365 security spend-realization reporting. Gathers licensing and security-posture signals via Microsoft Graph and generates a self-contained HTML report plus JSON and CSV exports.'

    PowerShellVersion    = '7.4'

    RequiredModules      = @(
        @{ ModuleName = 'Microsoft.Graph.Authentication'; ModuleVersion = '2.15.0' }
    )

    FunctionsToExport    = @(
        'Connect-CHSITenant'
        'Disconnect-CHSITenant'
        'Test-CHSIPrerequisite'
        'Get-CHSISnapshot'
        'Invoke-CHSIAnalysis'
        'Export-CHSIReport'
        'New-CHSIReport'
    )
    CmdletsToExport      = @()
    VariablesToExport    = @()
    AliasesToExport      = @()

    PrivateData          = @{
        PSData = @{
            Tags         = @('Microsoft365', 'Security', 'Licensing', 'Graph', 'Reporting', 'ReadOnly', 'SecureScore')
            LicenseUri   = 'https://github.com/Cloud-Harbor-Consulting-LLC/M365-Security-Investment-Report/blob/main/LICENSE'
            ProjectUri   = 'https://github.com/Cloud-Harbor-Consulting-LLC/M365-Security-Investment-Report'
            ReleaseNotes = 'Pre-release. Walking skeleton: license inventory, spend, seat realization, board one-pager.'
        }
    }
}
