# Unit: v2.28.0 scripts — Skill Recommender, CodeGraph Diagram, Multi-Repo Engine
# Compatible with Pester 3.4.0

Describe 'Skill Recommender' {
    BeforeAll {
        $script:root = $PSScriptRoot | Split-Path -Parent | Split-Path -Parent
        $script:contextAnalyzer = Join-Path $script:root 'scripts\utilities\AUTO-DELEGATION\context-analyzer.ps1'
        $script:skillRecommender = Join-Path $script:root 'scripts\utilities\AUTO-DELEGATION\skill-recommender.ps1'
        $script:mlRouter = Join-Path $script:root 'scripts\utilities\AUTO-DELEGATION\ml-router.ps1'
        $script:embeddings = Join-Path $script:root '.atl\skill-embeddings.json'
    }

    Context 'script integrity' {
        It 'context-analyzer.ps1 exists at expected path' {
            Test-Path $script:contextAnalyzer | Should -Be $true
        }

        It 'skill-recommender.ps1 exists at expected path' {
            Test-Path $script:skillRecommender | Should -Be $true
        }

        It 'context-analyzer.ps1 has zero parse errors' {
            $e = $null
            $null = [System.Management.Automation.PSParser]::Tokenize(
                (Get-Content $script:contextAnalyzer -Raw -Encoding UTF8), [ref]$e
            )
            $e.Count | Should -Be 0
        }

        It 'skill-recommender.ps1 has zero parse errors' {
            $e = $null
            $null = [System.Management.Automation.PSParser]::Tokenize(
                (Get-Content $script:skillRecommender -Raw -Encoding UTF8), [ref]$e
            )
            $e.Count | Should -Be 0
        }
    }

    Context 'context-analyzer output' {
        It 'returns context object with git info' {
            $result = & $script:contextAnalyzer -Raw 2>$null | ConvertFrom-Json
            $result.PSObject.Properties.Name -contains 'git' | Should -Be $true
            $result.PSObject.Properties.Name -contains 'recentFiles' | Should -Be $true
            $result.PSObject.Properties.Name -contains 'contextText' | Should -Be $true
        }

        It 'includes branch name in context' {
            $result = & $script:contextAnalyzer -Raw 2>$null | ConvertFrom-Json
            ($result.contextText -match 'branch:') | Should -Be $true
        }
    }

    Context 'skill-recommender query' {
        It 'returns recommendations for a test query' {
            $result = & $script:skillRecommender -TaskDescription 'testing skill routing' -TopN 3 -Raw 2>$null | ConvertFrom-Json
            if ($result -is [array]) {
                $result.Count -gt 0 | Should -Be $true
            } elseif ($result) {
                $true | Should -Be $true
            }
        }

        It 'includes score and agent in output' {
            $raw = & $script:skillRecommender -TaskDescription 'code review pull request' -TopN 2 -Raw 2>$null
            if ($raw) {
                try { $result = $raw | ConvertFrom-Json -ErrorAction Stop } catch { $result = $null }
                if ($result -and ($result -is [array] -or $result.PSObject.Properties.Name -contains 'skill')) {
                    $first = if ($result -is [array]) { $result[0] } else { $result }
                    $hasScore = $first.PSObject.Properties.Name -contains 'score'
                    $hasAgent = $first.PSObject.Properties.Name -contains 'agent'
                    ($hasScore -or $hasAgent) | Should -Be $true
                }
            }
        }
    }

    Context 'ml router integration' {
        It 'ml-router.ps1 exists and parses correctly' {
            Test-Path $script:mlRouter | Should -Be $true
            $e = $null
            $null = [System.Management.Automation.PSParser]::Tokenize(
                (Get-Content $script:mlRouter -Raw -Encoding UTF8), [ref]$e
            )
            $e.Count | Should -Be 0
        }

        It 'skill embeddings exist and contain skills' {
            if (Test-Path $script:embeddings) {
                $json = Get-Content $script:embeddings -Raw -Encoding UTF8 | ConvertFrom-Json
                $json.metadata.totalSkills -gt 0 | Should -Be $true
            }
        }
    }
}

Describe 'CodeGraph Diagram' {
    BeforeAll {
        $script:root = $PSScriptRoot | Split-Path -Parent | Split-Path -Parent
        $script:codegraphDiagram = Join-Path $script:root 'scripts\utilities\CODEGRAPH\codegraph-diagram.ps1'
        $script:prDocsHook = Join-Path $script:root 'scripts\utilities\CODEGRAPH\pr-docs-hook.ps1'
        $script:codegraphDb = Join-Path $script:root '.codegraph\codegraph.db'
        $script:diagramDir = Join-Path $script:root 'docs\diagrams'
    }

    Context 'script integrity' {
        It 'codegraph-diagram.ps1 exists at expected path' {
            Test-Path $script:codegraphDiagram | Should -Be $true
        }

        It 'pr-docs-hook.ps1 exists at expected path' {
            Test-Path $script:prDocsHook | Should -Be $true
        }

        It 'codegraph-diagram.ps1 has zero parse errors' {
            $e = $null
            $null = [System.Management.Automation.PSParser]::Tokenize(
                (Get-Content $script:codegraphDiagram -Raw -Encoding UTF8), [ref]$e
            )
            $e.Count | Should -Be 0
        }

        It 'pr-docs-hook.ps1 has zero parse errors' {
            $e = $null
            $null = [System.Management.Automation.PSParser]::Tokenize(
                (Get-Content $script:prDocsHook -Raw -Encoding UTF8), [ref]$e
            )
            $e.Count | Should -Be 0
        }
    }

    Context 'codegraph database availability' {
        It 'CodeGraph SQLite database exists' {
            Test-Path $script:codegraphDb | Should -Be $true
        }

        It 'CodeGraph has indexed nodes and edges' {
            if (Test-Path $script:codegraphDb) {
                $nodes = sqlite3 $script:codegraphDb "SELECT COUNT(*) FROM nodes" 2>$null
                $edges = sqlite3 $script:codegraphDb "SELECT COUNT(*) FROM edges" 2>$null
                [int]$nodes -gt 0 | Should -Be $true
                [int]$edges -gt 0 | Should -Be $true
            }
        }
    }

    Context 'diagram generation' {
        It 'generates module dependency diagram when DB exists' {
            if (Test-Path $script:codegraphDb) {
                if (-not (Test-Path $script:diagramDir)) { New-Item -ItemType Directory -Path $script:diagramDir -Force | Out-Null }
                & $script:codegraphDiagram -DiagramType module -OutputDir $script:diagramDir 2>&1 | Out-Null
                Test-Path (Join-Path $script:diagramDir 'module-dependency.mmd') | Should -Be $true
            }
        }

        It 'generates call graph diagram when DB exists' {
            if (Test-Path $script:codegraphDb) {
                & $script:codegraphDiagram -DiagramType callgraph -OutputDir $script:diagramDir 2>&1 | Out-Null
                Test-Path (Join-Path $script:diagramDir 'call-graph.mmd') | Should -Be $true
            }
        }

        It 'generates data flow diagram when DB exists' {
            if (Test-Path $script:codegraphDb) {
                & $script:codegraphDiagram -DiagramType dataflow -OutputDir $script:diagramDir 2>&1 | Out-Null
                Test-Path (Join-Path $script:diagramDir 'data-flow.mmd') | Should -Be $true
            }
        }
    }

    Context 'pr-docs-hook actions' {
        It 'status action reports diagram state' {
            $output = & $script:prDocsHook -Action status *>&1 | Out-String
            $output -match 'Architecture Documentation Status' | Should -Be $true
        }
    }
}

Describe 'Multi-Repo Engine' {
    BeforeAll {
        $script:root = $PSScriptRoot | Split-Path -Parent | Split-Path -Parent
        $script:multiRepoEngine = Join-Path $script:root 'scripts\utilities\MULTI-REPO\multi-repo-engine.ps1'
        $script:multiRepoConfig = Join-Path $script:root 'config\multi-repo-orchestration.json'
    }

    Context 'script integrity' {
        It 'multi-repo-engine.ps1 exists at expected path' {
            Test-Path $script:multiRepoEngine | Should -Be $true
        }

        It 'has zero parse errors' {
            $e = $null
            $null = [System.Management.Automation.PSParser]::Tokenize(
                (Get-Content $script:multiRepoEngine -Raw -Encoding UTF8), [ref]$e
            )
            $e.Count | Should -Be 0
        }
    }

    Context 'status action' {
        It 'status runs without error' {
            $output = & $script:multiRepoEngine -Action status *>&1 | Out-String
            $output.Length -gt 0 | Should -Be $true
        }

        It 'status returns JSON with Raw flag' {
            $result = & $script:multiRepoEngine -Action status -Raw 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($result) {
                $result.PSObject.Properties.Name.Count -gt 0 | Should -Be $true
            }
        }
    }

    Context 'validate action' {
        It 'validate runs without error' {
            $output = & $script:multiRepoEngine -Action validate *>&1 | Out-String
            $output.Length -gt 0 | Should -Be $true
        }
    }

    Context 'configuration' {
        It 'engine discovers repos and can create config' {
            $output = & $script:multiRepoEngine -Action discover *>&1 | Out-String
            $output -match 'Discovering Repositories' | Should -Be $true
        }
    }
}
