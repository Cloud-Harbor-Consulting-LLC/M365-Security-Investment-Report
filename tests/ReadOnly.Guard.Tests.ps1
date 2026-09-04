#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

<#
    The read-only guarantee is the product. A CISO consents this tool because it cannot
    write to their tenant, so that claim is enforced by CI rather than by promise.

    These tests fail the build if anyone -- human or otherwise -- introduces a mutating
    Graph call, or gives the Graph chokepoint a -Method parameter that would let a caller
    choose a verb.
#>

BeforeAll {
    $script:SourceRoot = Join-Path $PSScriptRoot '..' 'src' | Resolve-Path
    $script:SourceFiles = @(Get-ChildItem -Path $script:SourceRoot -Filter '*.ps1' -Recurse -File)
    $script:ChokepointPath = Join-Path $script:SourceRoot 'CloudHarbor.M365SecurityInvestment/Private/Common/Invoke-CHSIGraphRequest.ps1'
}

Describe 'Read-only guarantee' {

    It 'ships at least one source file to inspect' {
        $script:SourceFiles.Count | Should -BeGreaterThan 0
    }

    Context 'No mutating Microsoft Graph cmdlets' {

        It 'contains no <Verb>-Mg* call in <File>' -ForEach @(
            foreach ($file in @(Get-ChildItem -Path (Join-Path $PSScriptRoot '..' 'src') -Filter '*.ps1' -Recurse -File)) {
                foreach ($verb in 'New', 'Set', 'Update', 'Remove', 'Add', 'Restore', 'Revoke', 'Reset', 'Send', 'Clear') {
                    @{ Verb = $verb; File = $file.Name; Path = $file.FullName }
                }
            }
        ) {
            $content = Get-Content -LiteralPath $Path -Raw
            $content | Should -Not -Match "\b$Verb-Mg[A-Z]" -Because "$File must not issue mutating Microsoft Graph calls"
        }
    }

    Context 'Graph traffic is funnelled through one GET-only chokepoint' {

        It 'calls Invoke-MgGraphRequest from exactly one file' {
            $callers = @(
                $script:SourceFiles | Where-Object {
                    (Get-Content -LiteralPath $_.FullName -Raw) -match 'Invoke-MgGraphRequest'
                }
            )
            $callers.Count | Should -Be 1
            $callers[0].Name | Should -Be 'Invoke-CHSIGraphRequest.ps1'
        }

        It 'hardcodes the GET verb' {
            $content = Get-Content -LiteralPath $script:ChokepointPath -Raw
            $content | Should -Match "\`$method\s*=\s*'GET'"
        }

        It 'exposes no -Method parameter, so no caller can choose a verb' {
            $ast = [System.Management.Automation.Language.Parser]::ParseFile($script:ChokepointPath, [ref]$null, [ref]$null)
            $function = $ast.FindAll(
                { param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-CHSIGraphRequest' },
                $true
            ) | Select-Object -First 1

            $function | Should -Not -BeNullOrEmpty
            $parameterNames = @($function.Body.ParamBlock.Parameters.Name.VariablePath.UserPath)
            $parameterNames | Should -Not -Contain 'Method'
        }

        It 'never passes a non-GET verb to Invoke-MgGraphRequest' {
            $content = Get-Content -LiteralPath $script:ChokepointPath -Raw
            foreach ($verb in 'POST', 'PUT', 'PATCH', 'DELETE') {
                $content | Should -Not -Match "'$verb'"
            }
        }
    }

    Context 'No raw HTTP mutation' {

        It 'does not call Invoke-RestMethod or Invoke-WebRequest anywhere in <File>' -ForEach @(
            foreach ($file in @(Get-ChildItem -Path (Join-Path $PSScriptRoot '..' 'src') -Filter '*.ps1' -Recurse -File)) {
                @{ File = $file.Name; Path = $file.FullName }
            }
        ) {
            $content = Get-Content -LiteralPath $Path -Raw
            $content | Should -Not -Match '\bInvoke-(RestMethod|WebRequest)\b' -Because 'all Graph traffic must go through Invoke-CHSIGraphRequest'
        }
    }
}
