function Invoke-CHSIGraphRequest {
    <#
    .SYNOPSIS
        The single chokepoint for all Microsoft Graph traffic in this module.

    .DESCRIPTION
        Read-only by construction: this function accepts no -Method parameter, so there is
        no code path through which a caller can issue anything other than a GET. Every
        other function in the module reaches Graph through here, which means auditing the
        module's read-only guarantee means auditing this one function.

        Also handles paging (@odata.nextLink), throttling (429 / 503 with Retry-After),
        and transient failures with exponential backoff.

    .PARAMETER Uri
        Absolute Graph URI, or a path relative to the Graph endpoint (e.g. '/v1.0/organization').

    .PARAMETER All
        Follow @odata.nextLink and return the accumulated 'value' collection.

    .PARAMETER MaxRetry
        Retry attempts for throttled or transient responses. Default 5.

    .PARAMETER MaxPage
        Safety valve on paged collections. Default 1000 pages.

    .PARAMETER AsImage
        Return the response as an image data URI, or $null when there is no image. For the
        tenant's company-branding logo, which Graph serves as bytes rather than JSON.

    .OUTPUTS
        Without -All: the response body as a hashtable.
        With -All: the accumulated 'value' array.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [ValidateNotNullOrEmpty()]
        [string]$Uri,

        [switch]$All,

        [ValidateRange(0, 10)]
        [int]$MaxRetry = 5,

        [ValidateRange(1, 10000)]
        [int]$MaxPage = 1000,

        [switch]$AsImage
    )

    # GET is hardcoded. Do not add a -Method parameter to this function: the read-only
    # guarantee is the whole product, and it is enforced here and by tests/ReadOnly.Guard.Tests.ps1.
    $method = 'GET'

    $next       = if ($Uri -match '^https?://') { $Uri } else { "https://graph.microsoft.com$($Uri -replace '^(?!/)', '/')" }
    $collected  = [System.Collections.Generic.List[object]]::new()
    $pageNumber = 0
    $lastBody   = $null

    while ($next) {
        $pageNumber++
        if ($pageNumber -gt $MaxPage) {
            Write-CHSILog -Level Warning -Source 'Graph' -Message "Stopped paging at the $MaxPage-page safety limit for '$Uri'. Results are incomplete."
            break
        }

        $attempt  = 0
        $response = $null

        while ($true) {
            try {
                Write-CHSILog -Level Debug -Source 'Graph' -Message "$method $next (page $pageNumber, attempt $($attempt + 1))"
                if ($AsImage) {
                    $message = Invoke-MgGraphRequest -Method $method -Uri $next -OutputType HttpResponseMessage -ErrorAction Stop
                    return ConvertTo-CHSIImageDataUri -Response $message
                }
                $response = Invoke-MgGraphRequest -Method $method -Uri $next -OutputType Hashtable -ErrorAction Stop
                break
            }
            catch {
                $status = Get-CHSIHttpStatusCode -ErrorRecord $_
                $isTransient = $status -in @(429, 500, 502, 503, 504)

                if (-not $isTransient -or $attempt -ge $MaxRetry) {
                    # Re-throw with the status code attached so callers can branch on 403 etc.
                    $wrapped = [System.Management.Automation.ErrorRecord]::new(
                        [System.Exception]::new("Graph GET '$next' failed$(if ($status) { " with HTTP $status" }): $($_.Exception.Message)", $_.Exception),
                        'CHSIGraphRequestFailed',
                        [System.Management.Automation.ErrorCategory]::ConnectionError,
                        $next
                    )
                    $wrapped.ErrorDetails = [System.Management.Automation.ErrorDetails]::new(($status ?? 0).ToString())
                    throw $wrapped
                }

                $attempt++
                $delay = Get-CHSIRetryDelaySecond -ErrorRecord $_ -Attempt $attempt
                Write-CHSILog -Level Warning -Source 'Graph' -Message "HTTP $status on '$next'. Retry $attempt of $MaxRetry in ${delay}s."
                Start-Sleep -Seconds $delay
            }
        }

        $lastBody = $response

        if (-not $All) { return $response }

        if ($response -is [hashtable] -and $response.ContainsKey('value')) {
            foreach ($item in @($response['value'])) { $collected.Add($item) }
        }
        elseif ($null -ne $response) {
            $collected.Add($response)
        }

        $next = if ($response -is [hashtable] -and $response.ContainsKey('@odata.nextLink')) {
            $response['@odata.nextLink']
        }
        else {
            $null
        }
    }

    if ($All) {
        Write-CHSILog -Level Debug -Source 'Graph' -Message "Collected $($collected.Count) item(s) across $pageNumber page(s) from '$Uri'."
        return @($collected)
    }

    $lastBody
}

function Get-CHSIHttpStatusCode {
    <#
    .SYNOPSIS
        Digs an HTTP status code out of an error record, tolerating the several shapes the
        Graph SDK and underlying HTTP stack use.
    #>
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [Parameter(Mandatory)]
        [System.Management.Automation.ErrorRecord]$ErrorRecord
    )

    $ex = $ErrorRecord.Exception

    while ($ex) {
        foreach ($property in 'StatusCode', 'ResponseStatusCode') {
            $value = $ex.PSObject.Properties[$property]
            if ($value -and $null -ne $value.Value) {
                $code = 0
                if ([int]::TryParse(($value.Value -as [int]), [ref]$code) -or ($code = $value.Value -as [int])) {
                    if ($code -gt 0) { return $code }
                }
            }
        }

        $response = $ex.PSObject.Properties['Response']
        if ($response -and $response.Value) {
            $code = $response.Value.PSObject.Properties['StatusCode']
            if ($code -and $null -ne $code.Value) {
                $parsed = $code.Value -as [int]
                if ($parsed -gt 0) { return $parsed }
            }
        }

        $ex = $ex.InnerException
    }

    # Last resort: the message itself often carries the code.
    if ($ErrorRecord.Exception.Message -match '\b(4\d{2}|5\d{2})\b') {
        return [int]$Matches[1]
    }

    0
}

function Get-CHSIRetryDelaySecond {
    <#
    .SYNOPSIS
        Honors a Retry-After header when Graph supplies one; otherwise exponential backoff
        with jitter.
    #>
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [Parameter(Mandatory)]
        [System.Management.Automation.ErrorRecord]$ErrorRecord,

        [Parameter(Mandatory)]
        [int]$Attempt
    )

    $ex = $ErrorRecord.Exception
    while ($ex) {
        $response = $ex.PSObject.Properties['Response']
        if ($response -and $response.Value) {
            $headers = $response.Value.PSObject.Properties['Headers']
            if ($headers -and $headers.Value) {
                try {
                    $retryAfter = $headers.Value.RetryAfter
                    if ($retryAfter -and $retryAfter.Delta) {
                        return [Math]::Min([int]$retryAfter.Delta.TotalSeconds, 300)
                    }
                }
                catch {
                    Write-CHSILog -Level Debug -Source 'Graph' -Message 'Retry-After header present but unreadable; falling back to backoff.'
                }
            }
        }
        $ex = $ex.InnerException
    }

    $backoff = [Math]::Min([Math]::Pow(2, $Attempt), 60.0)
    [int]($backoff + (Get-Random -Minimum 0 -Maximum 2))
}

function ConvertTo-CHSIImageDataUri {
    <#
    .SYNOPSIS
        Turns a Graph image response into a data URI, or $null when it holds no usable image.

    .DESCRIPTION
        Graph answers an unset company-branding logo with an empty JSON body rather than a
        404, so anything that is not a raster image of a sane size reads as "no logo". SVG is
        refused because it can carry script, and Entra accepts only PNG and JPEG logos.

        The format is read from the file's own first bytes. The Content-Type header is not
        trusted, because Graph documents its logo answers as the wildcard image/*, which names
        no format.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [System.Net.Http.HttpResponseMessage]$Response,

        [int]$MaxByte = 200000
    )

    $status = [int]$Response.StatusCode
    if ($status -in 204, 404) { return $null }
    if (-not $Response.IsSuccessStatusCode) {
        throw "Graph GET returned HTTP $status for an image."
    }
    if (-not $Response.Content) { return $null }

    $bytes = $Response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    if ($bytes.Length -eq 0 -or $bytes.Length -gt $MaxByte) { return $null }

    $type = Get-CHSIImageType -Bytes $bytes
    if (-not $type) { return $null }

    "data:$type;base64,$([Convert]::ToBase64String($bytes))"
}

function Get-CHSIImageType {
    <#
    .SYNOPSIS
        The raster image type named by a file's first bytes, or $null when it is not one.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [byte[]]$Bytes
    )

    # Each type, with the byte signatures it must carry and where each one starts.
    $signatures = @(
        @{ Type = 'image/png'; Parts = @(@{ At = 0; Sig = 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }) }
        @{ Type = 'image/jpeg'; Parts = @(@{ At = 0; Sig = 0xFF, 0xD8, 0xFF }) }
        @{ Type = 'image/gif'; Parts = @(@{ At = 0; Sig = 0x47, 0x49, 0x46, 0x38 }) }
        @{ Type = 'image/webp'; Parts = @(@{ At = 0; Sig = 0x52, 0x49, 0x46, 0x46 }, @{ At = 8; Sig = 0x57, 0x45, 0x42, 0x50 }) }
    )

    foreach ($candidate in $signatures) {
        $matched = $true
        foreach ($part in $candidate.Parts) {
            if ($Bytes.Length -lt $part.At + $part.Sig.Count) { $matched = $false; break }
            for ($i = 0; $i -lt $part.Sig.Count; $i++) {
                if ($Bytes[$part.At + $i] -ne $part.Sig[$i]) { $matched = $false; break }
            }
            if (-not $matched) { break }
        }
        if ($matched) { return $candidate.Type }
    }
    $null
}
