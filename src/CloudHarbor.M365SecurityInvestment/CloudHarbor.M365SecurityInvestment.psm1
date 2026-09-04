#Requires -Version 7.4
Set-StrictMode -Version Latest

# Module-wide paths, resolved once at import.
$script:CHSIModuleRoot = $PSScriptRoot
$script:CHSIDataPath   = Join-Path $PSScriptRoot 'Data'
$script:CHSIAssetPath  = Join-Path $PSScriptRoot 'Assets'
$script:CHSIVersion    = (Import-PowerShellDataFile -Path (Join-Path $PSScriptRoot 'CloudHarbor.M365SecurityInvestment.psd1')).ModuleVersion

# Declared here rather than lazily, because Set-StrictMode makes reading an
# unassigned variable a terminating error.
$script:CHSIDataCache  = @{}
$script:CHSIRunLog     = [System.Collections.Generic.List[object]]::new()

# Dot-source Private first (Public depends on it), then Public.
foreach ($scope in 'Private', 'Public') {
    $root = Join-Path $PSScriptRoot $scope
    if (-not (Test-Path $root)) { continue }

    Get-ChildItem -Path $root -Filter '*.ps1' -Recurse -File |
        Sort-Object FullName |
        ForEach-Object {
            try {
                . $_.FullName
            }
            catch {
                throw "Failed to load '$($_.FullName)': $($_.Exception.Message)"
            }
        }
}

# Only Public functions are exported; the manifest is the authoritative list.
$public = Get-ChildItem -Path (Join-Path $PSScriptRoot 'Public') -Filter '*.ps1' -File -ErrorAction SilentlyContinue
if ($public) {
    Export-ModuleMember -Function $public.BaseName
}
