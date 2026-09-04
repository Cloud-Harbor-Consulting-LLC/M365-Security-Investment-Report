function Get-CHSIRequiredScope {
    <#
    .SYNOPSIS
        The complete set of read-only Graph scopes this module uses, and what each one buys.

    .DESCRIPTION
        Loaded from Data/graph-scopes.json, which the browser app's MSAL configuration
        reads too. One definition means the consent screen, the docs and the report's
        provenance table cannot describe different things.

        Least privilege is the trust signal that gets this consented, so nothing goes in
        that file without a reason a CISO would accept.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param()

    $path = Join-Path $script:CHSIDataPath 'graph-scopes.json'
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required data file 'graph-scopes.json' was not found at '$path'. The module installation is incomplete."
    }

    $data = Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json -Depth 10

    foreach ($entry in $data.scopes) {
        [pscustomobject]@{
            Scope              = $entry.scope
            Required           = [bool]$entry.required
            Purpose            = $entry.purpose
            LeastPrivilegeRole = $entry.leastPrivilegeRole
        }
    }
}

function Assert-CHSIScope {
    <#
    .SYNOPSIS
        Compares granted scopes against what the module needs and reports the gap.

    .DESCRIPTION
        Never throws for an optional scope -- a tenant without Entra ID P1 or Security
        Reader should still get the report it can have, with the missing parts labeled.
        Throws only when a required scope is absent, because the report would be
        meaningless without it.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [string[]]$GrantedScope,

        [switch]$ThrowOnMissingRequired
    )

    if (-not $PSBoundParameters.ContainsKey('GrantedScope')) {
        $context = Get-CHSIGraphContext
        $GrantedScope = if ($context) { @($context.Scopes) } else { @() }
    }

    $granted  = @($GrantedScope)
    $required = Get-CHSIRequiredScope

    $evaluated = foreach ($item in $required) {
        [pscustomobject]@{
            Scope              = $item.Scope
            Required           = $item.Required
            Granted            = $granted -contains $item.Scope
            Purpose            = $item.Purpose
            LeastPrivilegeRole = $item.LeastPrivilegeRole
        }
    }

    $missingRequired = @($evaluated | Where-Object { $_.Required -and -not $_.Granted })
    $missingOptional = @($evaluated | Where-Object { -not $_.Required -and -not $_.Granted })

    foreach ($item in $missingOptional) {
        Write-CHSILog -Level Warning -Source 'Scopes' -Message "Optional scope '$($item.Scope)' was not granted. Affected sections will be reported as not measured."
    }

    if ($missingRequired.Count -gt 0 -and $ThrowOnMissingRequired) {
        $names = @($missingRequired | Select-Object -ExpandProperty Scope) -join ', '
        throw "Missing required read-only scope(s): $names. Reconnect with Connect-CHSITenant to consent them."
    }

    # A cached Graph session can carry far more permission than this tool asks for -- the
    # SDK reuses whatever token is on disk. The report claims least privilege, so it has to
    # disclose when the session actually holds more, and especially when it holds a write
    # scope. The tool still issues only GETs; this is about not overstating the consent.
    $ignorable = @('openid', 'profile', 'email', 'offline_access', 'User.Read')
    $requestedScopes = @($required | Select-Object -ExpandProperty Scope)
    $extra = @($granted | Where-Object { $_ -notin $requestedScopes -and $_ -notin $ignorable })
    $writeScopes = @($extra | Where-Object { $_ -match '\.(ReadWrite|Write|Manage|FullControl)' })

    foreach ($scope in $writeScopes) {
        Write-CHSILog -Level Warning -Source 'Scopes' -Message "The signed-in session carries the write scope '$scope', which this tool does not request and never uses. Consider connecting with a least-privilege session before producing a client deliverable."
    }

    # Select-Object rather than @($collection.Property): under Set-StrictMode, member
    # access on an empty array is a terminating error, and "no missing scopes" is the
    # expected case.
    [pscustomobject]@{
        Scopes           = @($evaluated)
        GrantedScopes    = $granted
        MissingRequired  = @($missingRequired | Select-Object -ExpandProperty Scope)
        MissingOptional  = @($missingOptional | Select-Object -ExpandProperty Scope)
        ExtraScopes      = $extra
        ExtraWriteScopes = $writeScopes
        Satisfied        = ($missingRequired.Count -eq 0)
    }
}

function Get-CHSIGraphContext {
    <#
    .SYNOPSIS
        Returns the current Graph context, or $null when not connected.
    .DESCRIPTION
        Wrapped so that offline analysis and fixture-driven tests never fail merely
        because Microsoft.Graph.Authentication is absent or disconnected.
    #>
    [CmdletBinding()]
    param()

    if (-not (Get-Command -Name 'Get-MgContext' -ErrorAction SilentlyContinue)) {
        return $null
    }

    try {
        Get-MgContext -ErrorAction Stop
    }
    catch {
        Write-CHSILog -Level Debug -Source 'Graph' -Message "No active Graph context: $($_.Exception.Message)"
        $null
    }
}
