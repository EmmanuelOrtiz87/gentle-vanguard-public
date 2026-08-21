# Gentle-Vanguard - Visual Guide

> Complete visual reference with diagrams, charts, and flow illustrations.

---

## 1. System Architecture

### 1.1 High-Level Overview

```

                         GENTLE_VANGUARD



       Developer               CLI                  Skills
        Input      (src/cli/gv.ts)     System




                             Bootstrap             Orchestrator
                              Engine                (Review)





              Project    Templates     Hooks    Reports
                Root



```

### 1.2 Component Flow

```

                                        PROJECT CREATION
                                            WORKFLOW






              gv new --name           Wizard Mode              gv new --
              my-project              (Interactive)            clone <url>





                          BOOTSTRAP ENGINE

                       1. Read config.json
                       2. Validate tools
                       3. Copy templates
                       4. Install skills
                       5. Setup hooks
                       6. Generate context





                                        PROJECT CREATED

                              src/      docs/    skills/    hooks/


```

---

## 2. Code Review Orchestrator

### 2.1 Unified Flow Diagram

```

                     CODE REVIEW ORCHESTRATOR - UNIFIED FLOW



                                 USER ACTION






      git commit               gv review                CI/CD
       (AUTO)                  (MANUAL)                 PIPELINE





      PRE-COMMIT                 FULL OR                 AUTOMATED
        HOOK                    CHESTRATOR                REVIEW




     FAST SCAN                ALL SCANS                ALL SCANS
     (Secrets +              (7 Dimensions)           (7 Dimensions)
      Quality)



    CRITICAL FOUND?          Generate Report          Generate Report



    YES    NO

              REPORT SAVED             REPORT SAVED
  BLOCK  ALLOW          docs/code-reviews/            docs/code-reviews/
        +WARN




    Show Issues Show Issues
     + Actions   + Actions

```

### 2.2 Pre-commit Hook Flow

```
                              git commit



                      pre-commit-review.ps1




                      Reentrant Check?
                      (.hooks/marker exists)



                YES                              NO


            SKIP                       Create Marker File
          (Exit 0)



                                      Get Staged Files




                                      Critical Secrets Scan
                                       AWS Keys
                                       GitHub Tokens
                                       API Keys
                                       Private Keys



                                    CRITICAL FOUND?

                                    YES                    NO


                               [X] BLOCK            Run Quick Scan
                               (Exit 1)           (Security +
                                     Quality)



                                                    Report Generated



                                                    Cleanup & Exit
                                                Remove Marker File

```

### 2.3 Review Dimensions

```
                    CODE REVIEW ORCHESTRATOR - 7 DIMENSIONS




           SECURITY           QUALITY           ARCHITECT.
              [S]               [Q]               [A]


          Secrets        Code Smells          Structure
          Vulnerabilities    Complexity        Patterns
          CVEs          Error Handling      Coupling
          OWASP         Empty Catch         Modularity




            TESTING             DOCS             API DSGN
              [T]               [D]               [API]


          Coverage       README           REST Compliance
          Patterns      Changelog      Validation
          Edge Cases    Comments        Error Responses
          Mocks         ADRs           versióning




                           GIT FLOW
                              [G]


                          Commit Messages
                          Branch Naming
                          Hooks Configuration
                          PR Descriptions


```

---

## 3. Project Types

### 3.1 Available Templates

```

                        PROJECT TYPE TEMPLATES



       SERVICE          CLI          LIBRARY       FRONTEND
        [SVC]          [CLI]         [LIB]         [FE]

      API           Go            npm pkg       React
      Backend       Rust          PyPI          Vue
      Worker        Node          Go mod        Angular
      Daemon                                      Next.js



      FULLSTACK    MICROSERVCS       MOBILE         API
        [FS]           [MS]          [M]           [A]

      Nx Mono       Gateway       React Nat     REST
      FE + BE       Services      Flutter       GraphQL
      Shared        K8s                         gRPC
       packages       Docker

```

### 3.2 Project Structure Tree

```

                      SERVICE PROJECT STRUCTURE


my-service/

 .git/                     # Git repository
    hooks/               # Pre-commit hooks (auto-installed)

 .gentle-vanguard/    # Skills (auto-installed)
    skills/
        code-review-orchestrator/

 src/                     # Source code
    cmd/                # Entry points
       server/
           main.go
    internal/           # Private code
       handlers/
       middleware/
       models/
       services/
    pkg/                # Public packages

 api/                    # API definitions
    openapi.yaml
    proto/

 configs/               # Configuration
    config.yaml
    .env.example

 scripts/               # Automation
    deploy.ps1
    migrate.ps1

 tests/                  # Test files
    unit/
    integration/

 Dockerfile              # Container
 docker-compose.yml     # Local dev
 .editorconfig          # Code style
 .gitignore
 README.md
 CHANGELOG.md
 docs/
     project-context.md
     security-best-practices.md
```

---

## 4. CI/CD Integration

### 4.1 Pipeline Flow

```

                         CI/CD PIPELINE FLOW



      PUSH     BUILD    TEST     SCAN





     DEPLOY   REVIEW    LINT   SECURITY



                         DETAILED PIPELINE

    Push/PR



     STAGE 1: BUILD
       Install dependencies
       Compile/Transpile code
       Generate artifacts




     STAGE 2: TEST
       Unit tests
       Integration tests
       Coverage report




     STAGE 3: LINT
       ESLint / Prettier
       TypeScript check
       Style enforcement




     STAGE 4: SECURITY (gv review --scope security)
       Secrets scan
       Vulnerability check
       Dependency audit




     STAGE 5: CODE REVIEW
       gv review --report
       Generate issues report
       Post to PR comments




     STAGE 6: DEPLOY (on merge to main)
       Docker build & push
       Kubernetes deployment
       Smoke tests

```

---

## 5. Command Reference

### 5.1 CLI Commands Map

```

                          CLI COMMANDS MAP



                               gv <command>






  init                     new                   review
     [SETUP]                 [CREATE]               [AUDIT]





    Create dirs         --name     --kind            --scope
    Git config         --kind     --preset           --report
    Verify tools       --preset   --arch            --track
                       --arch     --interactive      --verbose




 doctor                 validate                 skills
     [DIAG]                 [CHECK]                [LIST]



    Prerequisites           Workspace              Available
    Git config               validation             Install
    Directory structure     Project checks         Update
```

### 5.2 Review Scope Options

```

                      REVIEW SCOPE OPTIONS



                        gv review --scope <option>



          all           Full review - All 7 dimensions
       (default)         Security + Quality + Architecture
                          Testing + Documentation
       API Design + Git Workflow
                           NOTE: May take longer


        security       Security-focused review
                      [S]          Secrets detection
                Vulnerability patterns
                                      OWASP Top 10
                                     -> Fast scan


        quality        Code quality review
                                [Q]          Code smells
                          Complexity
                                                Error handling
                                               -> Fast scan


                           architecture      Architecture review
                               [A]           Project structure
                          Design patterns
                                                Separation of concerns
                         -> Manual check
                             testing
                               [T]           Testing review
                          Coverage metrics
                                                Test quality
                         -> Manual check
                              docs
                               [D]            Documentation review
                          README completeness
                                                API docs
                         -> Manual check
                           api               API design review
                               [API]           REST compliance
                          Validation
                                               -> Manual check

                              git
                               [G]            Git workflow review
                          Hooks
                                                Commit conventions
                         -> Manual check
                             quick
                              [Q]              Quick scan
                          Security (fast)
                                                Quality (fast)
                                               -> ~30 seconds


                                         full         Alias for 'all'


```

---

## 6. Benefits Comparison

### 6.1 Before vs After

```

                    BEFORE vs AFTER COMPARISON



                             TIME TO PRODUCTIVE


    BEFORE:

      Day 1         Day 2         Day 3         Day 4         Day 5



     Setup   Config   Tools   Learn   First   Start
     Env      IDE     Install  Repo    Code    Work





       5 DAYS TO PRODUCTIVE

    AFTER:

      Day 1



       gv new --name my-api
       gv review --scope all





            30 MINUTES TO PRODUCTIVE



    IMPROVEMENT: 95% reduction in setup time
```

### 6.2 Feature Comparison Matrix

```

                       FEATURE COMPARISON MATRIX


    Feature                     Manual  Traditional  Gentle-Vanguard

    Standardized project           NO       PART             YES
    structure

    Pre-commit security            NO        NO              YES
    scanning

    Automatic issue                NO       PART             YES
    detection

    Multi-dimensional              NO       PART             YES
    code review

    CI/CD templates                NO       PART             YES
    included

    Docker/Kubernetes              NO       PART             YES
    ready

    Cross-platform                 PART     PART             YES
    (Win/Linux/Mac)

    AI-ready with                  NO        NO              YES
    memory/prompts

    Dependency                     NO       PART             YES
    management

    Self-documenting               NO        NO              YES
    code reviews


    YES = Fully supported    PART = Partial/Manual    NO = Not available
```

---

## 7. Skill System Architecture

### 7.1 Skill Categories

```

                          SKILL SYSTEM OVERVIEW



                             AVAILABLE SKILLS



      [*] CORE SKILLS (Auto-installed on project creation)



       gentle-vanguard      code-review-orchestrator

       [P] Project scaffold     [R] Unified review
       [B] Bootstrapping        [7] 7 dimensions
       [C] CLI integration       [H] Pre-commit hooks




      [AI] AI ECOSYSTEM SKILLS



        Native Runtime        Workspace-Skills

       [S] SDD Workflow      [F] Framework patt.
       [M] Memory system     [T] Testing patt.
       [K] Skills system     [W] Workflow patt.


      Auto-installed for detected AI agents (Claude, OpenCode, Gemini)



      [T] TECHNICAL SKILLS (Available for specific needs)



        security-       testing-        git-          docker-
        expert          skill        workflow-        devops-
           [S]           [T]           skill          skill



           api-          archi-    documentation-
         design-        tecture-     governance
          skill         governanc
          [API]           [A]           [D]


```

### 7.2 Workspace-Skills Library

```

                       WORKSPACE-SKILLS LIBRARY



      FRONTEND SKILLS



      angular/        react-19       nextjs-15      tailwind-4
      core

      Signals       Compiler       App Router     CSS 4
      Standalone    no useMemo     Server Act.     No var()
      Inject        Server Fn.     Streaming      cn()



       typescript       zod-4        zustand-5       angular/
                                                      forms

      Strict        Schema        State mgmt     Signal
      Generics      Validation     Slices         Reactive
      Interfaces     Transform      Persist        Validation



      BACKEND & TESTING SKILLS



      django-drf       ai-sdk-5        playwright        pytest


      ViewSets       AI SDK 5      E2E tests      Fixtures
      Serializers    Providers      Page Obj.      Mocking
      Filters        Streaming      Selectors       Markers



      WORKFLOW SKILLS



      github-pr        jira-task       jira-epic     skill-creator

      PR format      Std format     Epic format    Create new
      Conventional    Acceptance     Stories        Templates
       Commits        Criteria        Link TKs       Best pract.

```

### 7.3 Skill Installation Paths

```

                      AI AGENT SKILL PATHS


    Agent            Skill Directory

    Claude Code     ~/.claude/skills/
    OpenCode        ~/.config/opencode/skills/
    Gemini CLI      ~/.gemini/skills/
    Cursor          ~/.cursor/skills/
    VS Code         ~/.copilot/skills/
    Codex           ~/.codex/skills/
    Windsurf        ~/.codeium/windsurf/skills/
```

---

## 8. File Templates

### 8.1 Included Templates

```

                          TEMPLATE LIBRARY



                              CI/CD TEMPLATES



      GitHub Actions      GitLab CI       Azure Pipelines
      .github/workflows/ .gitlab-ci.yml    azure-pipelines.
                                               yml

      CI workflow       Build stage       Build
      Container        Test stage        Test
      Preview          Deploy stage      Deploy



                            CONTAINER TEMPLATES



      Dockerfile          Dockerfile.go     Dockerfile.python
      (Node.js)          (Go)              (Python)

      Multi-stage       Multi-stage       Multi-stage
      Non-root          Non-root          Non-root
      Healthcheck       Healthcheck       Healthcheck



                         KUBERNETES MANIFESTS (k8s/)



     deployment        service         ingress           hpa

      Replicas       Port map       TLS            CPU/Memory
      Resources      Selector       Rules          Min/Max



                            CONFIG TEMPLATES



      .editorconfig   eslintrc.json   prettierrc       tsconfig

      Universal      React/TS       Formatting      Strict
      All IDEs      Security       Single src     Path alias



      vitest.config  jest.config     playwright.config

      Fast tests     Coverage       E2E tests
      TypeScript    TypeScript     Screenshots

```

---

## 9. Quick Reference Card

```


                    GENTLE_VANGUARD - QUICK REFERENCE



  INITIALIZATION

  gv init                    Initialize workspace
  gv new --name my-api      Create new project

  CODE REVIEW

  gv review                   Full review (all dimensions)
  gv review --scope security  Security only
  gv review --scope quick    Fast scan (~30s)
  gv review --report         Generate detailed report
  gv review --track          Export issues to CSV

  PRE-COMMIT (Automatic)

  git commit               Triggers pre-commit hook
   Secrets scan -> BLOCK if critical
   Quality scan -> Allow + warn
   Report generated

  PROJECT TYPES

  service      API, backend, worker
  cli          Command-line tools
  library      Reusable packages
  frontend     React, Vue, Angular, Next.js
  fullstack   Monorepo with Nx
  microservices Distributed architecture
  mobile      React Native, Flutter

  SEVERITY LEVELS

  [!C] CRITICAL   Block deployment - Security breach risk
  [!H] HIGH       Fix before merge - Major quality issue
  [!M] MEDIUM     Fix soon - Technical debt
  [!L] LOW        Consider - Best practice


```

---

## 10. System Requirements

```

                        SYSTEM REQUIREMENTS



                              REQUIRED



          GIT              TypeScript            GIT
       versión 2.30+       Core 7+            configured

      Windows           Windows           user.name
      Linux            Linux            user.email
      macOS            macOS



                            RECOMMENDED



          DOCKER            NODE.JS               GO
       (optional)           20+               1.21+

      Container dev     Node projects     Go projects
      Docker Compose    Nx monorepo       CLI tools



                             OPTIONAL



      KUBERNETES           ENGRAM             PYTHON
      (k8s)               (AI Memory)         3.10+

      Deployment        Session memory     Python proj
      Orchestration    Project context    ML projects

```

---

## 11. Troubleshooting

### 11.1 Common Issues Flow

```

                         TROUBLESHOOTING GUIDE


    ISSUE: "command not found: gv"




     Check TypeScript execution policy



           YES                     NO


     Set policy:            Use full path:
     Set-Execution           .\scripts\utilities\src/cli/gv.ts
     Policy -Scope           init
     CurrentUser
     -Execution
     Policy
     RemoteSigned




    ISSUE: "Git not found"




     Install Git from https://git-scm.com




    ISSUE: "Pre-commit hook not running"




     Check .git/hooks/pre-commit exists?



           YES                     NO


     File has               Run: gv new --name
     execute                <project>
     permission?            to regenerate hooks


```

---

_Document generated by Gentle-Vanguard_
