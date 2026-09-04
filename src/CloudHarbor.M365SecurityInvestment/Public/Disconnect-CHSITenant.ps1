function Disconnect-CHSITenant {
    <#
    .SYNOPSIS
        Signs out of Microsoft Graph and clears the module's cached tenant data.

    .EXAMPLE
        Disconnect-CHSITenant
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param()

    if (-not (Get-Command -Name 'Disconnect-MgGraph' -ErrorAction SilentlyContinue)) {
        Write-Verbose 'Microsoft.Graph.Authentication is not loaded; nothing to disconnect.'
        return
    }

    if (-not (Get-CHSIGraphContext)) {
        Write-Verbose 'No active Microsoft Graph session.'
        return
    }

    if ($PSCmdlet.ShouldProcess('Microsoft Graph', 'Disconnect')) {
        try {
            Disconnect-MgGraph -ErrorAction Stop | Out-Null
            Write-CHSILog -Level Info -Source 'Auth' -Message 'Disconnected from Microsoft Graph.'
        }
        catch {
            Write-Warning "Disconnect did not complete cleanly: $($_.Exception.Message)"
        }
    }
}
