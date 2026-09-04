function Export-CHSIReport {
    <#
    .SYNOPSIS
        Writes the report model out as self-contained HTML, JSON and CSV.

    .DESCRIPTION
        The HTML is a single file with every asset inlined -- stylesheet, fonts, logo,
        favicon and charts -- so it renders offline and survives being emailed as an
        attachment. The JSON and CSV exports carry the same dataset for finance and
        automation consumers.

    .PARAMETER Report
        The report model from Invoke-CHSIAnalysis.

    .PARAMETER OutputPath
        Directory to write into. Created if it does not exist. Defaults to the current
        directory.

    .PARAMETER BaseName
        Base file name. Defaults to a name derived from the tenant domain and date.

    .PARAMETER Format
        Which formats to emit. Defaults to all three.

    .EXAMPLE
        Export-CHSIReport -Report $report -OutputPath .\out
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory, ValueFromPipeline)]
        [object]$Report,

        [string]$OutputPath = '.',

        [string]$BaseName,

        [ValidateSet('Html', 'Json', 'Csv')]
        [string[]]$Format = @('Html', 'Json', 'Csv')
    )

    process {
        if (-not (Test-Path -LiteralPath $OutputPath)) {
            if ($PSCmdlet.ShouldProcess($OutputPath, 'Create output directory')) {
                New-Item -Path $OutputPath -ItemType Directory -Force | Out-Null
            }
        }
        $outputRoot = (Resolve-Path -LiteralPath $OutputPath).Path

        if (-not $BaseName) {
            $slug = if ($Report.Tenant.DefaultDomain) { ($Report.Tenant.DefaultDomain -split '\.')[0] }
                    elseif ($Report.Tenant.DisplayName) { $Report.Tenant.DisplayName }
                    else { 'tenant' }
            $slug = ($slug -replace '[^\w\-]', '-').Trim('-').ToLowerInvariant()
            $BaseName = "M365-Security-Investment-$slug-$(([datetime]$Report.GeneratedAt).ToString('yyyyMMdd'))"
        }

        $written = [System.Collections.Generic.List[string]]::new()

        if ($Format -contains 'Html') {
            $path = Join-Path $outputRoot "$BaseName.html"
            if ($PSCmdlet.ShouldProcess($path, 'Write HTML report')) {
                $html = ConvertTo-CHSIHtml -Report $Report
                Set-Content -LiteralPath $path -Value $html -Encoding utf8
                $written.Add($path)
                Write-CHSILog -Level Info -Source 'Export' -Message "HTML report written to $path ($([Math]::Round((Get-Item -LiteralPath $path).Length / 1KB)) KB)."
            }
        }

        if ($Format -contains 'Json') {
            $path = Join-Path $outputRoot "$BaseName.json"
            if ($PSCmdlet.ShouldProcess($path, 'Write JSON export')) {
                Set-Content -LiteralPath $path -Value (ConvertTo-CHSIJson -Report $Report) -Encoding utf8
                $written.Add($path)
            }
        }

        if ($Format -contains 'Csv') {
            $inventoryPath = Join-Path $outputRoot "$BaseName-inventory.csv"
            $summaryPath   = Join-Path $outputRoot "$BaseName-summary.csv"

            if ($PSCmdlet.ShouldProcess($inventoryPath, 'Write CSV exports')) {
                ConvertTo-CHSIInventoryCsvRow -Report $Report |
                    Export-Csv -LiteralPath $inventoryPath -NoTypeInformation -Encoding utf8
                $written.Add($inventoryPath)

                ConvertTo-CHSISummaryCsvRow -Report $Report |
                    Export-Csv -LiteralPath $summaryPath -NoTypeInformation -Encoding utf8
                $written.Add($summaryPath)
            }
        }

        [pscustomobject]@{
            OutputPath = $outputRoot
            BaseName   = $BaseName
            Files      = @($written)
            Html       = @($written | Where-Object { $_ -like '*.html' }) | Select-Object -First 1
        }
    }
}
