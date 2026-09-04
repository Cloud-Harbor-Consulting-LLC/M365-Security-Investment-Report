function Get-CHSIRequiredScope {
    <#
    .SYNOPSIS
        The complete set of read-only Graph scopes this module uses, and what each one buys.

    .DESCRIPTION
        Kept as data so Test-CHSIPrerequisite, Connect-CHSITenant, the README and the
        report's provenance block all describe the same list. Least privilege is the
        trust signal that gets this consented, so nothing goes in here without a reason
        a CISO would accept.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param()

    @(
        [pscustomobject]@{
            Scope       = 'Organization.Read.All'
            Required    = $true
            Purpose     = 'Tenant identity, verified domains, and the subscribed SKU inventory that the whole report is built on.'
            LeastPrivilegeRole = 'Global Reader'
        }
        [pscustomobject]@{
            Scope       = 'Directory.Read.All'
            Required    = $true
            Purpose     = 'Directory objects and role assignments, used to confirm the running identity is a reader and to resolve license assignment.'
            LeastPrivilegeRole = 'Global Reader'
        }
        [pscustomobject]@{
            Scope       = 'User.Read.All'
            Required    = $true
            Purpose     = 'Per-user account state and license assignment: the basis for seat-level waste analysis.'
            LeastPrivilegeRole = 'Global Reader'
        }
        [pscustomobject]@{
            Scope       = 'AuditLog.Read.All'
            Required    = $false
            Purpose     = 'Sign-in activity for the never-signed-in and inactive waste categories. Also requires Entra ID P1 on the tenant; without it Graph returns 403 for the entire user query.'
            LeastPrivilegeRole = 'Global Reader'
        }
        [pscustomobject]@{
            Scope       = 'SecurityEvents.Read.All'
            Required    = $false
            Purpose     = 'Secure Score, its 90-day history, peer benchmarks, and the control-level status that proves whether a licensed security feature is actually deployed.'
            LeastPrivilegeRole = 'Security Reader'
        }
    )
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

    # Select-Object rather than @($collection.Property): under Set-StrictMode, member
    # access on an empty array is a terminating error, and "no missing scopes" is the
    # expected case.
    [pscustomobject]@{
        Scopes          = @($evaluated)
        GrantedScopes   = $granted
        MissingRequired = @($missingRequired | Select-Object -ExpandProperty Scope)
        MissingOptional = @($missingOptional | Select-Object -ExpandProperty Scope)
        Satisfied       = ($missingRequired.Count -eq 0)
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
