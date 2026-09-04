function Test-CHSIPrerequisite {
    <#
    .SYNOPSIS
        Pre-flight check: PowerShell version, Graph module, connection state, granted
        scopes, config validity and shipped data files.

    .DESCRIPTION
        Run this before a client engagement. It answers "will this work, and what will be
        missing if it does" without collecting anything.

    .PARAMETER ConfigPath
        Optional path to a configuration file to validate.

    .EXAMPLE
        Test-CHSIPrerequisite -ConfigPath .\config\chsi-config.json
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [string]$ConfigPath
    )

    $checks = [System.Collections.Generic.List[object]]::new()

    $add = {
        param([string]$Name, [bool]$Passed, [string]$Detail, [bool]$Required = $true)
        $checks.Add([pscustomobject]@{
                Check    = $Name
                Passed   = $Passed
                Required = $Required
                Detail   = $Detail
            })
    }

    # --- Runtime ---------------------------------------------------------------
    $psOk = $PSVersionTable.PSVersion -ge [version]'7.4'
    & $add 'PowerShell 7.4+' $psOk "Running PowerShell $($PSVersionTable.PSVersion)."

    $graphModule = Get-Module -ListAvailable -Name 'Microsoft.Graph.Authentication' |
        Sort-Object Version -Descending | Select-Object -First 1
    & $add 'Microsoft.Graph.Authentication' ([bool]$graphModule) $(
        if ($graphModule) { "Version $($graphModule.Version) available." }
        else { 'Not installed. Install-Module Microsoft.Graph.Authentication -Scope CurrentUser' }
    )

    # --- Shipped data ----------------------------------------------------------
    foreach ($dataFile in 'sku-catalog', 'pricelist', 'feature-map', 'risk-model') {
        try {
            $loaded = Get-CHSIDataFile -Name $dataFile -NoCache
            $count = if ($loaded.PSObject.Properties['skus']) { @($loaded.skus).Count }
                     elseif ($loaded.PSObject.Properties['prices']) { @($loaded.prices).Count }
                     elseif ($loaded.PSObject.Properties['features']) { @($loaded.features).Count }
                     elseif ($loaded.PSObject.Properties['scenarios']) { @($loaded.scenarios).Count }
                     else { 0 }
            & $add "Data file: $dataFile.json" $true "Loaded, $count entries."
        }
        catch {
            & $add "Data file: $dataFile.json" $false $_.Exception.Message
        }
    }

    # --- Pricing basis ---------------------------------------------------------
    $priceList = Get-CHSIDataFile -Name 'pricelist'
    & $add 'Price list verified' ([bool]$priceList.verified) $(
        if ($priceList.verified) { "Verified as of $($priceList.asOf)." }
        else { "SEED DATA, NOT VERIFIED (as of $($priceList.asOf)). Verify list prices or supply negotiated rates before using this with a client." }
    ) $false

    # --- Config ----------------------------------------------------------------
    if ($ConfigPath) {
        try {
            $config = Import-CHSIConfig -Path $ConfigPath
            & $add 'Configuration file' $true "Loaded '$ConfigPath'. Inactivity threshold $($config.inactivity.thresholdDays) days, currency $($config.pricing.currency)."
        }
        catch {
            & $add 'Configuration file' $false $_.Exception.Message
        }
    }
    else {
        & $add 'Configuration file' $true 'None supplied; built-in defaults will be used.' $false
    }

    # --- Connection and scopes -------------------------------------------------
    $context = Get-CHSIGraphContext
    if ($context) {
        & $add 'Graph connection' $true "Connected to tenant $($context.TenantId) as $($context.Account ?? $context.ClientId) ($($context.AuthType))."

        $assessment = Assert-CHSIScope -GrantedScope @($context.Scopes)
        foreach ($scope in $assessment.Scopes) {
            & $add "Scope: $($scope.Scope)" $scope.Granted $(
                if ($scope.Granted) { $scope.Purpose }
                elseif ($scope.Required) { "REQUIRED and not granted. $($scope.Purpose)" }
                else { "Optional and not granted; affected sections will report as not measured. $($scope.Purpose)" }
            ) $scope.Required
        }
    }
    else {
        & $add 'Graph connection' $false 'Not connected. Run Connect-CHSITenant first. (Offline analysis from a saved snapshot does not require a connection.)' $false
    }

    $results = @($checks)
    $failedRequired = @($results | Where-Object { $_.Required -and -not $_.Passed })

    [pscustomobject]@{
        Ready          = ($failedRequired.Count -eq 0)
        Checks         = $results
        FailedRequired = @($failedRequired | Select-Object -ExpandProperty Check)
        Warnings       = @($results | Where-Object { -not $_.Required -and -not $_.Passed } | Select-Object -ExpandProperty Check)
    }
}
