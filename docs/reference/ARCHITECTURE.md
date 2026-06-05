# Gentle-Vanguard - Architecture

> System design, component relationships, and technical decisións.

---

## 1. System Architecture

### 1.1 High-Level View

```

                           SYSTEM ARCHITECTURE



                                     DEVELOPER
                                      (You)




                                 CLI LAYER

                            gv.ps1 (Main Entry)

             init       new       review    validate  ...






                              ENGINE LAYER


           Bootstrap        Review           Validation
           Engine          Orchestrator     Engine








                              OUTPUT LAYER


         Projects    Reports      Hooks       Skills



                            AI ECOSYSTEM LAYER


           Native        Gentleman-       Engram
           Runtime         Skills         Memory





```

### 1.2 Component Dependencies

```

                         COMPONENT DEPENDENCIES


    gv.ps1 (CLI)

         Read-Workspace-Config

                  workspace.config.json

         Bootstrap-Engine  Create-Project  Copy-Templates

                                      Install-Skills

                                               Project-Skills
                                                Workspace-Skills

                                      Setup-Hooks

                                               Native-Precommit-Review
                                               Code-Review-Hook

         Review-Orchestrator  Security-Scan

                                          Quality-Scan

                            Generate-Report

         AI-Ecosystem

                    Native Runtime Router (SDD Workflow)
                     Workspace-Skills (Framework Patterns)
                    Engram (Persistent Memory)

                             docs/code-reviews/



    Dependencies flow: CLI -> Engine -> Output
    Configuration: JSON files (runtime-resolved)
    Templates: Static files (copy-once)
```

---

## Artifact Retention Policy

Gentle-Vanguard stores operational artifacts with a dual-scope retention model:

1. **Repo scope (example only)**
   - Keep **1** most recent file per category in the repo.
   - Categories: `docs/audits/`, `docs/sessions/`, `docs/code-reviews/`.

2. **Local scope (full history)**
   - Archive all older files to `docs/.local-archive/` (gitignored).
   - Default retention: **30** files per category (configurable).

Rotation is automated on `end-session` and `day-end-closure`.

---

## 2. Bootstrap Flow

### 2.1 Project Creation Pipeline

```

                        BOOTSTRAP PIPELINE


    User Input                  Bootstrap                   Output





     gv new                Read Config            Project
     --name                   Structure
     --kind



                             Validate Input






               Clone         Copy         Generate
               (repo)        Template     Context






                                    Install Skills




                                    Setup Hooks




                                       Complete

```

### 2.2 Template Resolution

```

                      TEMPLATE RESOLUTION


    templates/

     project-root/                  Base template (always copied)
        .editorconfig
        .gitignore
        README.md
        src/
        tests/
        Dockerfile
        docker-compose.yml

     project-types/

         service/                 Overlay (if --kind=service)
            cmd/
            internal/
            .gitlab-ci.yml

         cli/                     Overlay (if --kind=cli)
            cmd/
            Makefile

         frontend/                Overlay (if --kind=frontend)
            src/
            public/
            package.json

         ... (more types)



    COPY SEQUENCE:

    1. Copy project-root/*          -> destination/
    2. Copy project-types/{kind}/*   -> destination/ (overlays)
    3. Apply {{placeholders}}       -> destination/
    4. Generate docs/project-context.md
```

---

## 3. Code Review Orchestrator Architecture

### 3.1 Orchestrator Components

```

                    ORCHESTRATOR COMPONENTS


    code-review.ps1

     Param Block
              Scope (all/security/quality/...)
              Path
              Report (switch)
              Track (switch)
              Verbose (switch)

     Issue Collection

              Add-Issue (function)

                       $Script:ISSUES array

              Increment-Counters (CRITICAL/HIGH/MEDIUM/LOW)

              Severity-Lookup

     Scan Functions

              Invoke-SecurityReview

                       Secret-Detection
                       Vulnerability-Scan

              Invoke-QualityReview
              Invoke-ArchitectureReview
              Invoke-TestingReview
              Invoke-DocumentationReview
              Invoke-APIReview
              Invoke-GitWorkflowReview

     Report Generation

              Get-ReportHeader
              Get-ReportBody
              Get-ReportFooter
              Export-IssuesToCSV

     Output

               Console (formatted)
               Markdown (docs/code-reviews/)
               CSV (optional)
```

### 3.2 Issue Object Structure

```

                         ISSUE OBJECT SCHEMA


    Issue {
        Id: int                    # Auto-incremented
        File: string               # Relative or absolute path
        Line: int                  # Line number (0 if unknown)
        Title: string              # Short description
        Severity: string           # CRITICAL | HIGH | MEDIUM | LOW
        Category: string          # Security | Quality | Architecture | ...
        Description: string       # Detailed explanation
        Impact: string            # Business/technical impact
        Recommendation: string    # How to fix
        Fix: string               # Suggested code fix (optional)
        Status: string            # open | in_progress | fixed | accepted
    }



    Example JSON Output:

    {
      "id": 1,
      "file": "src/auth/login.ts",
      "line": 42,
      "title": "SQL Injection Vulnerability",
      "severity": "CRITICAL",
      "category": "Security",
      "description": "User input concatenated directly into SQL query",
      "impact": "Unauthorized database access",
      "recommendation": "Use parameterized queries",
      "status": "open"
    }
```

---

## 4. Skill System Design

### 4.1 Skill Structure

```

                            SKILL STRUCTURE


    skills/

     {skill-name}/

         SKILL.md                    # Main skill file
                                         (triggers, rules, workflows)

         {skill-name}.ps1           # Main script (optional)

         configs/
              *.json               # Configuration files

         hooks/
              pre-commit-*.ps1     # Windows hooks
              pre-commit-*.sh      # Unix hooks

         prompts/
              *.md                 # AI prompts

         references/
              *.md                 # Documentation

         templates/
               *.md                 # Output templates
```

### 4.2 Skill Installation Flow

```

                      SKILL INSTALLATION FLOW


    Bootstrap-Engine


    Read config.skills []



     For each skill in config.skills:




     Source:            skills/{name}/
     {workspace}/
     skills/{name}       - SKILL.md
           - configs/
                          - hooks/
                          - ...




                         Destination:
                         {project}/
                         .workspace-
                         gentle-vanguard/
                         skills/{name}/




                         Install Hooks
                         (if hooks/ dir)




                            Complete

```

---

## 5. Hook System

### 5.1 Pre-commit Hook Flow

```

                         PRE-COMMIT HOOK FLOW


    git commit


    .git/hooks/pre-commit



     1. Reentrant Check
        Check .hooks/pre-commit.marker exists?

         NO


     2. Create Marker File
        Create .hooks/pre-commit.marker




     3. Get Staged Files
        git diff --cached --name-only




     4. Critical Secrets Scan
        Regex: AWS keys, tokens, API keys...


         CRITICAL FOUND  BLOCK (exit 1)



     5. Full Quick Scan (Security + Quality)
        Call code-review.ps1 -Scope quick




     6. Cleanup
        Remove .hooks/pre-commit.marker




     7. Exit
        0 = success, 1 = blocked

```

### 5.2 Reentrant Protection

```

                       REENTRANT PROTECTION


    Problem:

    git commit

         pre-commit hook calls code-review.ps1

                     code-review.ps1 calls git commands

                                 git operations might trigger hooks again

                                             INFINITE LOOP!

    Solution:


    .hooks/
     pre-commit.marker           Created at start, deleted at end

    Pre-commit Script:

    if (Test-Path ".hooks/pre-commit.marker") {
        Write-Host "[SKIP] Reentrant call detected"
        exit 0
    }

    New-Item ".hooks/pre-commit.marker" -ItemType File

    try {
        # ... scan logic ...
    }
    finally {
        Remove-Item ".hooks/pre-commit.marker"
    }
```

---

## 6. Configuration Model

### 6.1 Config Hierarchy

```

                      CONFIGURATION HIERARCHY



                            config/workspace.config.json
      (Project-specific defaults)

       dataRoot, toolsRoot, projectsRoot
       projectDefaults (kind, preset, architecture)
       tools (external tool configurations)
       skills (skills to install)


                                     (resolved)

                           RUNTIME CONTEXT

      Placeholders:
       {workspaceRoot}  C:\Projects\my-workspace
       {dataRoot}      .engram-data
       {toolsRoot}     scripts/utilities/
       {projectsRoot}  projects/


                                     (applied)

                          SKILL CONFIGS

      skills/code-review-orchestrator/configs/review-config.json
      skills/security-expert/configs/security-rules.json
      ...

```

### 6.2 Placeholder Resolution

```

                     PLACEHOLDER RESOLUTION


    config/workspace.config.json:

    {
      "dataRoot": "{workspaceRoot}/.engram-data",
      "toolsRoot": "{workspaceRoot}/tools",
      "projectsRoot": "{workspaceRoot}/projects"
    }



    Resolution Context:

    {
      workspaceRoot: "C:/Projects/my-workspace",
      dataRoot: "C:/Projects/my-workspace/.engram-data",
      toolsRoot: "C:/Projects/my-workspace/tools",
      projectsRoot: "C:/Projects/my-workspace/projects"
    }



    BEFORE:  "{workspaceRoot}/scripts/utilities/Workspace-Skills"
    AFTER:    "C:/Projects/my-workspace/scripts/utilities/Workspace-Skills"
```

---

## 7. Security Patterns

### 7.1 Secret Detection Rules

```

                         SECRET DETECTION RULES


    Category: Cloud Provider Keys

    AWS Access Key    -> AKIA[0-9A-Z]{16}
    AWS Secret Key    -> (?i)aws_secret_access_key["\s]*[=:]["'][A-Za-z0-9/+=]{40}["']
    Google API Key    -> AIza[0-9A-Za-z_-]{35}

    Category: Authentication Tokens

    GitHub Token      -> ghp_[A-Za-z0-9]{36}
    GitHub OAuth      -> gho_[A-Za-z0-9]{36}
    Slack Token       -> xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]+
    Stripe Key       -> sk_live_[0-9a-zA-Z]{24,}
    SendGrid Key     -> SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}

    Category: Generic Secrets

    API Key           -> (?i)(api[_-]?key|apikey)["\s]*[=:]["'][A-Za-z0-9]{20,}["']
    Bearer Token      -> (?i)bearer\s+[A-Za-z0-9_\-\.]+
    Database URL      -> (?i)(mysql|postgres|mongodb)://[^:\s]+:[^@\s]+@
    Private Key       -> -----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----



    Note: These patterns may match test/example code.
    Use --exclude-paths to skip test directories.
```

---

## 8. Technology decisións

### 8.1 PowerShell Core Choice

**decisión:** Use PowerShell Core (pwsh) as the primary scripting language.

**Rationale:**

```

                      TECHNOLOGY decisión: POWERSHELL


  [OK] Cross-platform (Windows, Linux, macOS)
  [OK] Native JSON/Object handling
  [OK] Built-in SSH/CI/CD support
  [OK] Scripting with functions and modules
  [OK] Easy to read/write for beginners
  [OK] Good IDE support (VSCode, PowerShell ISE)

   Slower than compiled languages (Go, Rust)
   Requires PowerShell Core installation
   Some syntax quirks (pipelines, objects)


```

### 8.2 JSON Configuration Over YAML

**decisión:** Use JSON for configuration files.

**Rationale:**

```

                   TECHNOLOGY decisión: JSON vs YAML


  JSON Advantages:                      YAML Advantages:

  [OK] Native PowerShell support        [OK] Human-readable
  [OK] No external dependencies          [OK] Supports comments
  [OK] ConvertFrom-Json one-liner       [OK] Better for complex nested config
  [OK] Consistent with package.json       [OK] Markdown-friendly

  decisión: JSON primarily, with JSONC (JSON with comments) where needed


```

---

## 9. File Organization

### 9.1 Directory Structure

```
gentle-vanguard/

 .github/                          # GitHub specific
    ISSUE_TEMPLATE/
         bug_report.yml
         feature_request.yml
         question.yml
    PULL_REQUEST_TEMPLATE.md
    CODEOWNERS
    FUNDING.yml

 config/                           # Configuration
    workspace.config.json         # Main config
    workspace.example.json        # Example config
    workspace.portable.json       # Portable variant

 docs/                             # Documentation
    installation.md
    project-types.md
    ai-models.md
    tools.md
    VISUAL-GUIDE.md             # Diagrams & charts
    ARCHITECTURE.md              # This file
    code-reviews/               # Generated reports

 scripts/                          # Main scripts
    gv.ps1                       # Main CLI
    bootstrap-workspace.ps1       # Project creation
    validate-workspace.ps1        # Validation
    deploy.ps1                    # Deployment
    migrate.ps1                   # Migrations
    git-hooks/
          pre-commit
          pre-push
          commit-msg

 skills/                           # AI Skills
    gentle-vanguard/
    code-review-orchestrator/
    security-expert/
    testing-skill/
    git-workflow-skill/
    documentation-governance/
    api-design-skill/
    architecture-governance/
    docker-devops-skill/

 templates/                         # Project templates
    project-root/                 # Base template
    project-types/
         service/
         cli/
         library/
         frontend/
         fullstack/
         microservices/
         mobile/
    config/                      # Config templates
         eslintrc.json
         prettierrc
         tsconfig.json
         vitest.config.ts
         jest.config.js
    editor/                     # Editor configs
         .editorconfig
         vscode/
         jetbrains/
         vim/
         emacs/
    testing/                    # Test templates
         playwright.config.ts
         tests/
    observability/              # Monitoring
         prometheus.yml
         grafana/
         alerts.yml
    api/                       # API specs
          openapi.yaml

 scripts/utilities/                            # External tools
    (tool repositories)

 CHANGELOG.md
 CONTRIBUTING.md
 README.md
```

---

## 10. Future Considerations

### 10.1 Potential Improvements

```

                      FUTURE IMPROVEMENTS


    Short Term (v2.1):

     Performance optimization for large codebases
     Parallel scanning for multiple dimensions
     Configurable exclusion patterns (glob support)
     Interactive fix suggestións with AI

    Medium Term (v2.2):

     Web dashboard for review reports
     Integration with Jira/Linear for issue tracking
     Historical trend analysis
     Team-level aggregations
     Custom skill SDK

    Long Term (v3.0):

     Real-time collaboration on reviews
     ML-based issue classification
     Automatic fix generation
     Cross-repository analysis
     Plugin system for custom checks
```

## 11. Shared Conventions & Protocols

Gentle-Vanguard now incorporates standardized protocols from `agent-teams-lite-main` to ensure
consistent agent behavior and token efficiency:

### 11.1 Skill Resolver Protocol

All sub-agent delegations must follow the **Skill Resolver Protocol**
(`docs/reference/SKILL-RESOLVER-PROTOCOL.md`). This ensures:

- Agents receive only relevant, compact skill rules (not full SKILL.md files).
- Matching is based on both **Code Context** (file types) and **Task Context** (actions).
- Token usage is optimized by injecting only 50-150 tokens per skill.

### 11.2 Persistence Contract

The **Persistence Contract** (`docs/reference/PERSISTENCE-CONTRACT.md`) defines how artifacts are
stored and retrieved across different modes:

- **Engram Mode:** Cross-session persistence via memory system.
- **OpenSpec Mode:** Filesystem-based storage for versión control.
- **Hybrid Mode:** Dual-write for maximum safety and auditability.
- **None Mode:** Inline-only results for ephemeral tasks.

### 11.3 SDD Phase Common Protocol

All Spec-Driven Development (SDD) phases follow the `sdd-phase-common.md` standards, ensuring:

- Parallel artifact retrieval using `mem_search` and `mem_get_observation`.
- Mandatory artifact persistence via `mem_save` with `topic_key` for upserts.
- Structured return envelopes for orchestrator synthesis.

---

_Architecture document for Gentle-Vanguard v2.1_
