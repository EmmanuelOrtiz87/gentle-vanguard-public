# Technology Support Matrix v1.0=

Complete technology stack support for Gentle-Vanguard.

## Supported Platforms=

| Platform   | Version                | Status       | Notes                       |
| ---------- | ---------------------- | ------------ | --------------------------- |
| Windows    | 10/11, Server 2016+    | ✅ Full      | TypeScript 7+, Lefthook     |
| Linux      | Ubuntu 20.04+, RHEL 8+ | ✅ Full      | TypeScript 7+, bash scripts |
| macOS      | 12+ (Monterey)         | ✅ Full      | TypeScript 7+, Homebrew     |
| Docker     | All platforms          | ✅ Container | Multi-stage builds          |
| Kubernetes | 1.24+                  | ✅ Deploy    | Helm charts in templates/   |

## Language & Runtime Support=

### Backend=

| Language | Version    | Skills           | Templates | Notes           |
| -------- | ---------- | ---------------- | --------- | --------------- |
| C#/.NET  | .NET 6/7/8 | dotnet-api-skill | service/  | Full support    |
| Go       | 1.21+      | golang-api-skill | service/  | Full support    |
| Java     | 17+        | None yet         | service/  | Templates ready |
| Python   | 3.9+       | django-drf-skill | service/  | Full support    |
| Node.js  | 18+        | nextjs-15-skill  | service/  | Full support    |

### Frontend=

| Framework | Version  | Skills            | Templates | Notes                 |
| --------- | -------- | ----------------- | --------- | --------------------- |
| React     | 18/19    | react-19-skill    | frontend/ | React Compiler        |
| Angular   | 17/18/19 | angular-spa-skill | frontend/ | Standalone components |
| Vue       | 3.x      | None yet          | frontend/ | Ready for skill       |
| Svelte    | 4+       | None yet          | frontend/ | Ready for skill       |
| Next.js   | 14/15    | nextjs-15-skill   | service/  | App Router            |

### Mobile=

| Platform     | Version | Skills               | Templates | Notes             |
| ------------ | ------- | -------------------- | --------- | ----------------- |
| Android      | API 26+ | android-kotlin-skill | mobile/   | Kotlin Coroutines |
| iOS          | 16+     | ios-swift-skill      | mobile/   | SwiftUI patterns  |
| Flutter      | 3.x     | flutter-skill        | mobile/   | Cross-platform    |
| React Native | 0.72+   | react-native-skill   | mobile/   | Cross-platform    |

## Database Support=

| Database   | Version | Skills                    | Notes           |
| ---------- | ------- | ------------------------- | --------------- |
| PostgreSQL | 14+     | database-relational-skill | Full support    |
| MySQL      | 8.0+    | database-relational-skill | Full support    |
| MongoDB    | 6.0+    | database-nosql-skill      | Document models |
| Redis      | 7.0+    | database-nosql-skill      | Caching layer   |
| SQLite     | 3.40+   | database-relational-skill | Embedded DB     |

## Cloud Providers=

| Provider     | Services                    | Skills                      | Notes           |
| ------------ | --------------------------- | --------------------------- | --------------- |
| AWS          | EC2, S3, Lambda             | None yet                    | Ready for skill |
| Azure        | VM, Storage, Functions      | cloud-agent-connector-skill | Full support    |
| GCP          | Compute, Storage, Functions | None yet                    | Ready for skill |
| DigitalOcean | Droplets, Spaces            | None yet                    | Ready for skill |

## AI/ML Support=

| Provider     | Models           | Skills              | Notes                |
| ------------ | ---------------- | ------------------- | -------------------- |
| OpenAI       | GPT-4o, o1       | openai-config       | API + token tracking |
| Anthropic    | Claude 3.5       | anthropic-config    | API + token tracking |
| Local LLMs   | Olama, LM Studio | local-ai-skill      | Ready for skill      |
| Azure OpenAI | GPT-4, o1        | azure-openai-config | Enterprise ready     |

## CI/CD Platforms=

| Platform       | Status     | Workflows           | Notes           |
| -------------- | ---------- | ------------------- | --------------- |
| GitHub Actions | ✅ Full    | .github/workflows/  | Complete CI/CD  |
| Azure DevOps   | ✅ Full    | azure-pipelines.yml | Full support    |
| GitLab CI      | ✅ Full    | .gitlab-ci.yml      | Templates ready |
| Jenkins        | 🟢 Planned | Jenkinsfile         | Pipeline script |
| CircleCI       | 🟢 Planned | .circleci/          | Config ready    |

## IDE & Editor Support=

| IDE             | Version | Support | Notes                 |
| --------------- | ------- | ------- | --------------------- |
| VS Code         | 1.80+   | ✅ Full | Extensions + settings |
| Visual Studio   | 2022+   | ✅ Full | TypeScript tools      |
| JetBrains Rider | 2023+   | ✅ Full | TypeScript plugin     |
| Neovim          | 0.9+    | ✅ Full | LSP config            |
| Emacs           | 28+     | ✅ Full | init.el included      |

## Development Tools=

| Tool             | Purpose         | Status    | Notes               |
| ---------------- | --------------- | --------- | ------------------- |
| Lefthook         | Git hooks       | ✅ Active | v2.1.6              |
| Trufflehog       | Secret scanning | ✅ Active | Pre-commit hook     |
| PSScriptAnalyzer | Linting         | ✅ Active | TypeScript lint     |
| Pester           | Testing         | ✅ Active | v3.4.0              |
| GitVersion       | Versioning      | ✅ Active | Semantic versioning |

## Plugin Ecosystem=

| Plugin Type | Count | Status            | Notes        |
| ----------- | ----- | ----------------- | ------------ |
| Certified   | 0     | 🟢 In development | QA validated |
| Community   | 1     | ✅ Example ready  | Hello World  |
| Internal    | 0     | 🟢 Planned        | Enterprise   |

### Creating Custom Plugins=

See `plugins/examples/` for templates.

## Decision Matrix=

### When to use Gentle-Vanguard=

| Scenario                | Use Gentle-Vanguard? | Reason                  |
| ----------------------- | -------------------- | ----------------------- |
| Local-first development | ✅ Yes               | No cloud dependencies   |
| AI-assisted coding      | ✅ Yes               | 127 specialized skills  |
| Enterprise security     | ✅ Yes               | Lefthook + Trufflehog   |
| Team collaboration      | ✅ Yes               | Shared skills + configs |
| Open source project     | ✅ Yes               | MIT license, extensible |

### When to consider alternatives=

| Scenario            | Consider Alternative | Reason                   |
| ------------------- | -------------------- | ------------------------ |
| Cloud-only workflow | GitHub Copilot       | Native cloud integration |
| Simple scripts      | Direct TypeScript    | No orchestration needed  |
| Non-TypeScript team | Different tool       | Skill mismatch           |

## Version Compatibility=

| Gentle-Vanguard | TypeScript | Lefthook | Pester      | Node.js |
| --------------- | ---------- | -------- | ----------- | ------- |
| v2.6.x          | 7.0+       | 2.1.6+   | 3.4.0       | 18+     |
| v2.7.x (next)   | 7.2+       | 2.2+     | 3.4.0 / 5.x | 20+     |

---

_Version: 1.0 - 2026-05-05_ _Status: ACTIVE_
