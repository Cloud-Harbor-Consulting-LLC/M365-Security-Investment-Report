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
        [int]$MaxPage = 1000
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
