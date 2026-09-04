function Get-CHSISnapshot {
    <#
    .SYNOPSIS
        Runs every read-only collector and returns the raw tenant snapshot.

    .DESCRIPTION
        Collection only: no pricing, no analysis, no opinion. Keeping collection and
        analysis apart is what lets the analysis layer be tested end-to-end from a saved
        snapshot with no credentials and no network.

        -Path writes the snapshot to disk. This is a developer and support affordance, not
        persisted state: nothing reads a snapshot back automatically, and no run depends
        on a previous one. v1.0 is stateless by design.

    .PARAMETER Path
        Optional file path to save the snapshot as JSON.

    .EXAMPLE
        $snapshot = Get-CHSISnapshot

    .EXAMPLE
        Get-CHSISnapshot -Path .\contoso-snapshot.json
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [string]$Path
    )

    Clear-CHSIRunLog -Confirm:$false

    $context = Get-CHSIGraphContext
    if (-not $context) {
        throw 'Not connected to Microsoft Graph. Run Connect-CHSITenant first.'
    }

    $assessment = Assert-CHSIScope -GrantedScope @($context.Scopes) -ThrowOnMissingRequired

    Write-CHSILog -Level Info -Source 'Collect' -Message "Starting collection against tenant $($context.TenantId)."

    $collectors = [ordered]@{}
    $collectors['organization']   = Get-CHSIOrganizationData
    $collectors['subscribedSkus'] = Get-CHSISkuData

    foreach ($name in $collectors.Keys) {
        $collector = $collectors[$name]
        if (-not $collector.Available) {
            Write-CHSILog -Level Warning -Source 'Collect' -Message "Collector '$name' returned no data: $($collector.Reason)"
        }
    }

    $snapshot = [pscustomobject]@{
        SchemaVersion = '1.0'
        GeneratedAt   = [datetime]::UtcNow
        Tool          = [pscustomobject]@{
            Name    = 'CloudHarbor.M365SecurityInvestment'
            Version = $script:CHSIVersion
        }
        Source        = 'Graph'
        Context       = [pscustomobject]@{
            TenantId = $context.TenantId
            Account  = $context.Account
            ClientId = $context.ClientId
            AuthType = [string]$context.AuthType
            Scopes   = @($context.Scopes)
        }
        ScopeAssessment = $assessment
        Collectors    = [pscustomobject]$collectors
        RunLog        = @(Get-CHSIRunLog)
    }

    if ($Path) {
        $resolved = Save-CHSIJsonFile -Object $snapshot -Path $Path -Depth 12
        Write-Verbose "Snapshot saved to $resolved"
    }

    $snapshot
}

function Save-CHSIJsonFile {
    <#
    .SYNOPSIS
        Writes an object to disk as UTF-8 JSON, creating the parent directory if needed.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][object]$Object,
        [Parameter(Mandatory)][string]$Path,
        [int]$Depth = 12
    )

    $directory = Split-Path -Path $Path -Parent
    if ($directory -and -not (Test-Path -LiteralPath $directory)) {
        New-Item -Path $directory -ItemType Directory -Force | Out-Null
    }

    $Object | ConvertTo-Json -Depth $Depth | Set-Content -LiteralPath $Path -Encoding utf8
    (Resolve-Path -LiteralPath $Path).Path
}
