function Connect-CHSITenant {
    <#
    .SYNOPSIS
        Connects to Microsoft Graph with the read-only scopes this module needs.

    .DESCRIPTION
        Supports interactive sign-in for consultant-led runs and app-plus-certificate for
        unattended ones. Only the documented read-only scopes are requested -- the short,
        entirely read-only consent screen is the trust signal that gets a CISO to approve
        this tool at all.

        After connecting, granted scopes are checked against what the module needs and any
        shortfall is reported. Missing optional scopes are a warning, not an error: a
        tenant without Entra ID P1 or Security Reader still gets the report it can have.

    .PARAMETER TenantId
        Tenant GUID or verified domain, e.g. 'contoso.onmicrosoft.com'.

    .PARAMETER ClientId
        Application (client) ID for certificate-based unattended authentication.

    .PARAMETER CertificateThumbprint
        Thumbprint of a certificate in the current user's or machine's store.

    .PARAMETER Certificate
        An X509Certificate2 object, as an alternative to a thumbprint.

    .EXAMPLE
        Connect-CHSITenant -TenantId contoso.onmicrosoft.com

    .EXAMPLE
        Connect-CHSITenant -TenantId contoso.onmicrosoft.com -ClientId $appId -CertificateThumbprint $thumb
    #>
    [CmdletBinding(DefaultParameterSetName = 'Interactive')]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory, ParameterSetName = 'Interactive', Position = 0)]
        [Parameter(Mandatory, ParameterSetName = 'CertificateThumbprint')]
        [Parameter(Mandatory, ParameterSetName = 'Certificate')]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory, ParameterSetName = 'CertificateThumbprint')]
        [Parameter(Mandatory, ParameterSetName = 'Certificate')]
        [ValidateNotNullOrEmpty()]
        [string]$ClientId,

        [Parameter(Mandatory, ParameterSetName = 'CertificateThumbprint')]
        [ValidateNotNullOrEmpty()]
        [string]$CertificateThumbprint,

        [Parameter(Mandatory, ParameterSetName = 'Certificate')]
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,

        [Parameter(ParameterSetName = 'Interactive')]
        [switch]$UseDeviceCode
    )

    if (-not (Get-Command -Name 'Connect-MgGraph' -ErrorAction SilentlyContinue)) {
        throw "Microsoft.Graph.Authentication is not available. Install it with: Install-Module Microsoft.Graph.Authentication -Scope CurrentUser"
    }

    $scopes = @((Get-CHSIRequiredScope).Scope)

    $connectParams = @{
        TenantId    = $TenantId
        NoWelcome   = $true
        ErrorAction = 'Stop'
    }

    switch ($PSCmdlet.ParameterSetName) {
        'CertificateThumbprint' {
            $connectParams['ClientId'] = $ClientId
            $connectParams['CertificateThumbprint'] = $CertificateThumbprint
            Write-CHSILog -Level Info -Source 'Auth' -Message "Connecting to '$TenantId' with app '$ClientId' and certificate '$CertificateThumbprint'."
        }
        'Certificate' {
            $connectParams['ClientId'] = $ClientId
            $connectParams['Certificate'] = $Certificate
            Write-CHSILog -Level Info -Source 'Auth' -Message "Connecting to '$TenantId' with app '$ClientId' and a supplied certificate."
        }
        default {
            $connectParams['Scopes'] = $scopes
            if ($UseDeviceCode) { $connectParams['UseDeviceCode'] = $true }
            Write-CHSILog -Level Info -Source 'Auth' -Message "Connecting to '$TenantId' interactively, requesting $($scopes.Count) read-only scope(s)."
        }
    }

    Connect-MgGraph @connectParams

    $context = Get-CHSIGraphContext
    if (-not $context) {
        throw 'Connect-MgGraph returned no context. Authentication did not complete.'
    }

    # App-only tokens carry application roles rather than delegated scopes; the names
    # match, so the same comparison works for both.
    $assessment = Assert-CHSIScope -GrantedScope @($context.Scopes)

    $result = [pscustomobject]@{
        TenantId        = $context.TenantId
        Account         = $context.Account
        ClientId        = $context.ClientId
        AuthType        = $context.AuthType
        Scopes          = @($context.Scopes)
        MissingRequired = $assessment.MissingRequired
        MissingOptional = $assessment.MissingOptional
        Satisfied       = $assessment.Satisfied
    }

    if ($assessment.Satisfied) {
        Write-Verbose "Connected to $($context.TenantId) as $($context.Account ?? $context.ClientId)."
    }
    else {
        Write-Warning "Connected, but required scope(s) are missing: $($assessment.MissingRequired -join ', '). The report cannot be produced until these are consented."
    }

    $result
}
