function Get-CHSISecureScoreData {
    <#
    .SYNOPSIS
        Collects Microsoft Secure Score, its history, peer benchmarks, and the
        control-level detail that proves whether a security feature is actually deployed.

    .DESCRIPTION
        This is the evidence source for the whole entitled-versus-deployed analysis.

        Two endpoints, both read-only:
          /security/secureScores               up to 90 daily scores, each carrying
                                               controlScores[] and averageComparativeScores[]
          /security/secureScoreControlProfiles metadata per control: maximum score, tier,
                                               remediation guidance, effort and user impact

        Both are gated on SecurityEvents.Read.All, which is optional: a tenant that has
        not granted it still gets licence inventory, spend and seat waste. So a failure
        here degrades the feature analysis rather than ending the run.

        The history is read-only historical data returned by the same endpoint, not
        state this tool persists. v1.0 remains stateless.

        Scope: SecurityEvents.Read.All (least-privilege role: Security Reader).
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param()

    $unavailable = {
        param($Message)
        New-CHSICollectorResult -Name 'secureScore' -Available $false -Reason $Message
    }

    try {
        # Newest first. 90 days is what the endpoint retains and what the trend line needs.
        $scores = Invoke-CHSIGraphRequest -Uri '/v1.0/security/secureScores?$top=90' -All
    }
    catch {
        $status = 0
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $null = [int]::TryParse($_.ErrorDetails.Message, [ref]$status) }

        $reason = if ($status -eq 403) {
            'Secure Score requires SecurityEvents.Read.All, which was not granted. The deployed-versus-entitled analysis cannot be produced without it; everything else in this report is unaffected.'
        }
        else {
            "Could not read /security/secureScores: $($_.Exception.Message)"
        }
        return & $unavailable $reason
    }

    $scores = @($scores)
    if ($scores.Count -eq 0) {
        return & $unavailable 'Graph returned no Secure Score history for this tenant.'
    }

    # Control profiles carry the denominator. Without them a raw control score cannot be
    # turned into "deployed" or "not deployed", so their absence degrades rather than
    # fails: the scores themselves are still worth reporting.
    $profiles = @()
    $profileReason = $null
    try {
        $profiles = @(Invoke-CHSIGraphRequest -Uri '/v1.0/security/secureScoreControlProfiles' -All)
    }
    catch {
        $profileReason = "Control profiles could not be read, so control scores cannot be interpreted as deployed or not: $($_.Exception.Message)"
        Write-CHSILog -Level Warning -Source 'Collect' -Message $profileReason
    }

    $latest = $scores[0]

    $controlScores = @(
        if ($latest.ContainsKey('controlScores') -and $latest['controlScores']) {
            foreach ($control in $latest['controlScores']) {
                [pscustomobject]@{
                    ControlName     = $control['controlName']
                    ControlCategory = $control['controlCategory']
                    Score           = [double]($control['score'] ?? 0)
                    Description     = if ($control.ContainsKey('description')) { $control['description'] } else { $null }
                    State           = if ($control.ContainsKey('implementationStatus')) { $control['implementationStatus'] } else { $null }
                }
            }
        }
    )

    $comparative = @(
        if ($latest.ContainsKey('averageComparativeScores') -and $latest['averageComparativeScores']) {
            foreach ($peer in $latest['averageComparativeScores']) {
                [pscustomobject]@{
                    Basis        = $peer['basis']
                    AverageScore = [double]($peer['averageScore'] ?? 0)
                }
            }
        }
    )

    $history = @(
        foreach ($entry in $scores) {
            [pscustomobject]@{
                CreatedDateTime = $entry['createdDateTime']
                CurrentScore    = [double]($entry['currentScore'] ?? 0)
                MaxScore        = [double]($entry['maxScore'] ?? 0)
            }
        }
    )

    $controlProfiles = @(
        foreach ($controlProfile in $profiles) {
            $maxScore = 0
            if ($controlProfile.ContainsKey('maxScore')) { $maxScore = [double]($controlProfile['maxScore'] ?? 0) }

            [pscustomobject]@{
                ControlName        = $controlProfile['id']
                Title              = if ($controlProfile.ContainsKey('title')) { $controlProfile['title'] } else { $null }
                MaxScore           = $maxScore
                Service            = if ($controlProfile.ContainsKey('service')) { $controlProfile['service'] } else { $null }
                Tier               = if ($controlProfile.ContainsKey('tier')) { $controlProfile['tier'] } else { $null }
                Rank               = if ($controlProfile.ContainsKey('rank')) { [int]($controlProfile['rank'] ?? 0) } else { $null }
                Remediation        = if ($controlProfile.ContainsKey('remediation')) { $controlProfile['remediation'] } else { $null }
                ImplementationCost = if ($controlProfile.ContainsKey('implementationCost')) { $controlProfile['implementationCost'] } else { $null }
                UserImpact         = if ($controlProfile.ContainsKey('userImpact')) { $controlProfile['userImpact'] } else { $null }
                ActionUrl          = if ($controlProfile.ContainsKey('actionUrl')) { $controlProfile['actionUrl'] } else { $null }
            }
        }
    )

    $data = [pscustomobject]@{
        CurrentScore    = [double]($latest['currentScore'] ?? 0)
        MaxScore        = [double]($latest['maxScore'] ?? 0)
        CreatedDateTime = $latest['createdDateTime']
        ControlScores   = $controlScores
        Comparative     = $comparative
        History         = $history
        ControlProfiles = $controlProfiles
    }

    Write-CHSILog -Level Info -Source 'Collect' -Message "Secure Score: $($data.CurrentScore)/$($data.MaxScore), $($controlScores.Count) controls, $($history.Count) days of history."

    New-CHSICollectorResult -Name 'secureScore' -Data $data `
        -Degraded ([bool]$profileReason) -Reason $profileReason
}
