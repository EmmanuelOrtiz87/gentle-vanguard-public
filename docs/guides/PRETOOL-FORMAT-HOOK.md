# PreToolUse Auto-Format Hook

## Concept

Run linter/formatter **before** the AI agent accesses saved files. This eliminates:

- Wasted tokens on "fix indentation" discussions
- "The code has formatting issues" responses
- Manual formatting feedback loops

```
Traditional Flow (Wasteful):
Agent edits file  Agent reads file  "Fix indentation"  Agent edits  ...

PreTool Hook Flow (Efficient):
Agent edits file  Hook formats  Agent reads clean file  Done
```

## Hook Script

**Location:** `hooks/pre-tool-format.ps1`

### Supported File Types

| Extension | Formatter            | Config Required |
| --------- | -------------------- | --------------- |
| `.ps1`    | TypeScript Format    | -               |
| `.js`     | Prettier + ESLint    | package.json    |
| `.ts`     | Prettier + ESLint    | tsconfig.json   |
| `.tsx`    | Prettier             | tsconfig.json   |
| `.jsx`    | Prettier             | package.json    |
| `.py`     | Black + Ruff         | pyproject.toml  |
| `.go`     | gofmt                | go.mod          |
| `.rs`     | rustfmt              | Cargo.toml      |
| `.json`   | TypeScript Convert   | -               |
| `.md`     | Prettier             | package.json    |
| `.yaml`   | Prettier             | -               |
| `.css`    | Prettier + Stylelint | package.json    |
| `.html`   | Prettier             | -               |

## Integration by AI Agent

### OpenCode

Add to `~/.config/opencode/settings.json`:

```json
{
  "hooks": {
    "preToolUse": [
      {
        "name": "auto-format",
        "trigger": "Edit",
        "command": "pwsh",
        "args": [
          "-NoProfile",
          "-Command",
          "C:/Workspace_local/gentle-vanguard/hooks/pre-tool-format.ps1 -FilePath {{file}}"
        ]
      }
    ]
  }
}
```

Or create `~/.config/opencode/opencode.yaml`:

```yaml
hooks:
  pre_tool_use:
    - name: auto-format
      when:
        tool_names: ['edit', 'write']
        file_patterns: ['*.ps1', '*.ts', '*.js', '*.py', '*.go']
      run: pwsh
      args:
        - -NoProfile
        - -Command
        - C:/Workspace_local/gentle-vanguard/hooks/pre-tool-format.ps1
        - -FilePath
        - '{{file}}'
```

### Claude Code

Add to `.claude/skills/` or project-level hook:

```json
// .claude/hooks/pre-tool-format.json
{
  "name": "auto-format",
  "description": "Format files before agent access",
  "triggers": [
    {
      "tool": "Edit",
      "file_patterns": ["*.ps1", "*.ts", "*.js", "*.py", "*.go"]
    }
  ],
  "command": "pwsh",
  "args": [
    "-NoProfile",
    "-Command",
    "C:/Workspace_local/gentle-vanguard/hooks/pre-tool-format.ps1",
    "-FilePath",
    "{{file}}"
  ]
}
```

### VS Code Copilot

Create VS Code task in `.vscode/tasks.json`:

```json
{
  "versión": "2.0.0",
  "tasks": [
    {
      "label": "PreTool: Auto Format",
      "type": "shell",
      "command": "pwsh",
      "args": [
        "-NoProfile",
        "-Command",
        "C:/Workspace_local/gentle-vanguard/hooks/pre-tool-format.ps1",
        "-FilePath",
        "${file}"
      ],
      "problemMatcher": [],
      "runOptions": {
        "runOn": "default"
      }
    }
  ]
}
```

## Standalone Usage

```TypeScript
# Format single file
.\hooks\pre-tool-format.ps1 -FilePath ".\src\index.ts"

# Dry run (preview changes)
.\hooks\pre-tool-format.ps1 -FilePath ".\src\index.ts" -DryRun

# Verbose output
.\hooks\pre-tool-format.ps1 -FilePath ".\src\index.ts" -Verbose

# Format on save (VS Code)
# Add to .vscode/settings.json:
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode"
}
```

## Cost Savings Estimation

| Scenario               | Without Hook      | With Hook             |
| ---------------------- | ----------------- | --------------------- |
| Edit Fix indentation   | 500 tokens wasted | 0 tokens              |
| Edit ESLint issues     | 300 tokens wasted | 0 tokens              |
| Edit Black formatting  | 200 tokens wasted | 0 tokens              |
| **Per fix**            | **~1,000 tokens** | **~50 tokens** (hook) |
| **Monthly (50 fixes)** | **50,000 tokens** | **2,500 tokens**      |

## How It Works

```

                        Agent Edit
                    (User or LLM)




                    File Saved




                  PreToolUse Hook

    1. Detect file extension
    2. Check formatter availability
    3. Run appropriate formatter
    4. Apply fixes
    5. Report if changes made





                   Agent Read (Clean File)

```

## Troubleshooting

### "No formatter found"

**Cause:** No config file for that language in project.

**Solution:** Create config or install formatter globally:

```TypeScript
# TypeScript
Install-Module -Name PSScriptAnalyzer -Scope CurrentUser

# Node
npm install -g prettier eslint

# Python
pip install black ruff

# Go
go install golang.org/x/scripts/utilities/cmd/gofmt@latest
```

### "Formatter installed but not running"

**Cause:** Formatter not in PATH.

**Solution:** Use full path or ensure PATH includes:

```TypeScript
# Add to PATH
$env:PATH += ";C:\Program Files\nodejs;C:\Python311;$env:USERPROFILE\go\bin"
```

### "Permission denied"

**Cause:** Hook script blocked by execution policy.

**Solution:**

```TypeScript
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Best Practices

1. **Always use with git** - Formatter may change line endings
2. **Commit formatter config** - Ensure team consistency
3. **Use DryRun first** - Preview before applying
4. **Configure gitattributes** - Handle line ending differences

```bash
# .gitattributes for consistent line endings
* text=auto
*.ps1 text eol=crlf
*.sh text eol=lf
```

## Quick Install

```TypeScript
# Install to current project
Copy-Item ".\gentle-vanguard\\hooks\pre-tool-format.ps1" ".git\hooks\pre-tool-format.ps1"

# Or link for gentle-vanguard updates
New-Item -ItemType SymbolicLink -Path ".git\hooks\pre-tool-format.ps1" -Target ".\gentle-vanguard\\hooks\pre-tool-format.ps1"
```

---

**Last Updated:** 2026-04-17  
**Related:** [CLOUD-AGENT-CONNECTOR.md](CLOUD-AGENT-CONNECTOR.md)
