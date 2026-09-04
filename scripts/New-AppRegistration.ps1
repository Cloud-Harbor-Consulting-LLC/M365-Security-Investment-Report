#Requires -Version 7.4
#Requires -Modules Microsoft.Graph.Authentication, Microsoft.Graph.Applications

<#
.SYNOPSIS
    Creates the multi-tenant app registration that lets the browser app sign people in.

.DESCRIPTION
    THIS SCRIPT WRITES TO YOUR DIRECTORY. It is the only thing in this repository that
    does, and it is deliberately not part of the reporting module: the report tool issues
    Microsoft Graph GET requests exclusively and holds no write permission at any point.

    You run this once, in your own tenant, if you are publishing your own instance of the
    app. Nobody signing in to the published app ever runs it. When an administrator in
    another tenant consents, Entra creates the enterprise application over there
    automatically -- this script does not, and cannot, reach into anyone else's directory.

    What it creates:
      * One application registration, multi-tenant (AzureADMultipleOrgs)
      * Single-page application redirect URIs for the published site and local development
      * Requests for five DELEGATED Microsoft Graph permissions, all read-only

    What it does NOT do:
      * Grant consent. It prints the URL for that, so the grant stays a deliberate act.
      * Create a client secret. A single-page application must not have one.
      * Request any application permission, or any permission that can write.

    Re-running is safe: an existing registration with the same display name is updated
    rather than duplicated.

.PARAMETER DisplayName
    Name shown on the consent screen and in every customer's Enterprise Applications list,
    permanently. Choose plainly.

.PARAMETER RedirectUri
    SPA redirect URIs. Must match the app's own redirect exactly, including trailing slash.

.PARAMETER TenantId
    The tenant to create the registration in. Required, because the choice is permanent
    and getting it wrong is expensive.

    Use your ORGANISATION'S PRODUCTION tenant, never a demo or sandbox one:

      * Publisher verification requires the tenant to hold a DNS-verified custom domain
        matching the email domain of your Partner Center account. A demo tenant will not,
        so verification would fail later and every consent screen would keep reading
        "unverified publisher".
      * The registration is your publisher identity. Its home tenant is what customers
        see attributed on the consent screen.
      * Demo tenants get recycled. If this one is torn down, every customer's enterprise
        application breaks with it.
      * App registrations cannot be moved between tenants. Correcting this later means a
        new client ID, and everyone who already consented has to consent again.

    Because the registration is multi-tenant, one homed in production signs in to demo
    and customer tenants perfectly well. There is no reason to home it anywhere else.

.PARAMETER Force
    Proceed even though the target tenant looks like a demo or test tenant.

.EXAMPLE
    ./scripts/New-AppRegistration.ps1 -TenantId cloudharborconsulting.cloud

.EXAMPLE
    ./scripts/New-AppRegistration.ps1 -WhatIf
    Shows what would be created without touching the directory.
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
    Justification = 'An interactive setup script whose console output is the point. The script also returns a result object, which Write-Output would be indistinguishable from.')]
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$DisplayName = 'M365 Security Investment Report',

    [string[]]$RedirectUri = @(
        'https://cloud-harbor-consulting-llc.github.io/M365-Security-Investment-Report/'
        'http://localhost:5173/M365-Security-Investment-Report/'
    ),

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# The tenant choice is permanent: registrations cannot be moved, and correcting it later
# means a new client ID and re-consent from everyone who already granted it. Refuse the
# obvious mistake rather than discovering it at publisher verification.
if ($TenantId -match 'demo|test|sandbox|dev\b' -and -not $Force) {
    throw @"
'$TenantId' looks like a demo or test tenant.

The registration is your publisher identity and cannot be moved between tenants later.
Publisher verification also requires a DNS-verified domain matching your Partner Center
account's email domain, which a demo tenant will not have.

Because the app is multi-tenant, one registered in your production tenant signs in to
demo and customer tenants perfectly well. Use production, or pass -Force if you are
deliberately creating a throwaway.
"@
}

# Delegated, read-only, and identical to Data/graph-scopes.json. Read from that file so
# this script and the app can never ask for different things.
$scopeFile = Join-Path $PSScriptRoot '..' 'src' 'CloudHarbor.M365SecurityInvestment' 'Data' 'graph-scopes.json'
if (-not (Test-Path -LiteralPath $scopeFile)) {
    throw "Could not find graph-scopes.json at '$scopeFile'. Run this from inside the repository."
}
$wanted = @((Get-Content -LiteralPath $scopeFile -Raw | ConvertFrom-Json -Depth 10).scopes.scope)

Write-Host "Permissions to request (all delegated, all read-only):" -ForegroundColor Cyan
$wanted | ForEach-Object { Write-Host "  $_" }

foreach ($scope in $wanted) {
    if ($scope -notmatch '\.Read(\.All)?$') {
        throw "Refusing to continue: '$scope' is not a read-only scope."
    }
}

# --- Connect -----------------------------------------------------------------
$context = Get-MgContext -ErrorAction SilentlyContinue
if (-not $context -or 'Application.ReadWrite.All' -notin @($context.Scopes)) {
    $connect = @{ Scopes = 'Application.ReadWrite.All'; NoWelcome = $true }
    if ($TenantId) { $connect['TenantId'] = $TenantId }
    Write-Host "`nConnecting with Application.ReadWrite.All..." -ForegroundColor Cyan
    Connect-MgGraph @connect
    $context = Get-MgContext
}
Write-Host "Connected to tenant $($context.TenantId) as $($context.Account)" -ForegroundColor Green

# --- Resolve permission ids --------------------------------------------------
# Resolved from the directory rather than hardcoded, so a wrong GUID cannot silently
# request the wrong permission.
$graphSp = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'" -ErrorAction Stop
if (-not $graphSp) { throw 'Could not find the Microsoft Graph service principal in this tenant.' }

$resourceAccess = foreach ($name in $wanted) {
    $permission = $graphSp.Oauth2PermissionScopes | Where-Object Value -EQ $name
    if (-not $permission) { throw "Microsoft Graph does not expose a delegated permission called '$name'." }
    @{ Id = $permission.Id; Type = 'Scope' }   # 'Scope' = delegated. 'Role' would be an application permission.
}

$requiredResourceAccess = @(
    @{
        ResourceAppId  = '00000003-0000-0000-c000-000000000000'
        ResourceAccess = @($resourceAccess)
    }
)

# --- Create or update --------------------------------------------------------
$existing = Get-MgApplication -Filter "displayName eq '$($DisplayName -replace "'", "''")'" -ErrorAction SilentlyContinue |
    Select-Object -First 1

$body = @{
    DisplayName            = $DisplayName
    SignInAudience         = 'AzureADMultipleOrgs'      # multi-tenant
    Spa                    = @{ RedirectUris = @($RedirectUri) }
    RequiredResourceAccess = $requiredResourceAccess
    Web                    = @{ RedirectUris = @() }    # SPA only; no web reply URLs
}

if ($existing) {
    if ($PSCmdlet.ShouldProcess($DisplayName, 'Update existing app registration')) {
        Update-MgApplication -ApplicationId $existing.Id @body
        $app = Get-MgApplication -ApplicationId $existing.Id
        Write-Host "`nUpdated the existing registration." -ForegroundColor Yellow
    }
    else { return }
}
else {
    if ($PSCmdlet.ShouldProcess($DisplayName, 'Create multi-tenant app registration')) {
        $app = New-MgApplication @body
        Write-Host "`nCreated a new registration." -ForegroundColor Green
    }
    else { return }
}

# --- Report ------------------------------------------------------------------
$consentUri = "https://login.microsoftonline.com/$($context.TenantId)/adminconsent" +
              "?client_id=$($app.AppId)&redirect_uri=$([uri]::EscapeDataString($RedirectUri[0]))"

Write-Host ''
Write-Host ('-' * 72)
Write-Host "Client ID   : $($app.AppId)" -ForegroundColor Cyan
Write-Host "Object ID   : $($app.Id)"
Write-Host "Audience    : $($app.SignInAudience)"
Write-Host "Redirect    :"
$RedirectUri | ForEach-Object { Write-Host "              $_" }
Write-Host ('-' * 72)
Write-Host ''
Write-Host 'Next:' -ForegroundColor Cyan
Write-Host "  1. Set VITE_MSAL_CLIENT_ID=$($app.AppId) for the app build."
Write-Host '  2. Grant admin consent in your own tenant, to test:'
Write-Host "     $consentUri"
Write-Host ''
Write-Host 'The client ID is not a secret. It ships in the browser bundle by design.' -ForegroundColor DarkGray
Write-Host 'Until publisher verification is completed, consent screens will read' -ForegroundColor DarkGray
Write-Host '"unverified publisher".' -ForegroundColor DarkGray

[pscustomobject]@{
    ClientId    = $app.AppId
    ObjectId    = $app.Id
    DisplayName = $app.DisplayName
    ConsentUri  = $consentUri
}
