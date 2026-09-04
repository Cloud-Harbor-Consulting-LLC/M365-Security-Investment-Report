function Write-CHSILog {
    <#
    .SYNOPSIS
        Emits a run-log entry and mirrors it to the appropriate PowerShell stream.
    .DESCRIPTION
        Every entry is retained in $script:CHSIRunLog so the finished report can carry a
        provenance trail: what was collected, what degraded, and why. This is in-memory
        only for the life of the run -- nothing is written to disk and nothing persists
        between runs.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Message,

        [ValidateSet('Debug', 'Info', 'Warning', 'Error')]
        [string]$Level = 'Info',

        [string]$Source
    )

    if ($null -eq $script:CHSIRunLog) {
        $script:CHSIRunLog = [System.Collections.Generic.List[object]]::new()
    }

    $entry = [pscustomobject]@{
        Timestamp = [datetime]::UtcNow
        Level     = $Level
        Source    = $Source
        Message   = $Message
    }
    $script:CHSIRunLog.Add($entry)

    $prefix = if ($Source) { "[$Source] " } else { '' }
    switch ($Level) {
        'Debug'   { Write-Debug   ($prefix + $Message) }
        'Info'    { Write-Verbose ($prefix + $Message) }
        'Warning' { Write-Warning ($prefix + $Message) }
        'Error'   { Write-Error   ($prefix + $Message) -ErrorAction Continue }
    }
}

function Get-CHSIRunLog {
    <#
    .SYNOPSIS
        Returns the in-memory run log for the current run.
    #>
    [CmdletBinding()]
    param()

    if ($null -eq $script:CHSIRunLog) { return @() }
    @($script:CHSIRunLog)
}

function Clear-CHSIRunLog {
    <#
    .SYNOPSIS
        Resets the run log. Called at the start of each collection run.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param()

    if ($PSCmdlet.ShouldProcess('CHSI run log', 'Clear')) {
        $script:CHSIRunLog = [System.Collections.Generic.List[object]]::new()
    }
}
