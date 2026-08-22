# AI Tools Compatibility Matrix

**Date**: 2026-04-22  
**Status**: COMPATIBILITY AUDIT IN PROGRESS  
**Purpose**: Homologate token context, input/output messages, and chat protocols

---

## Overview

This document maps compatibility between Gentle-Vanguard and various AI scripts/utilities/plugins to
ensure consistent behavior across all integrations.

---

## Supported AI Tools

### Primary Tools (Full Support)

#### 1. Claude (Anthropic)

**Status**: FULLY SUPPORTED  
**versións**: Claude 3 Opus, Sonnet, Haiku  
**Integration Points**:

- Direct API integration
- Context window: Up to 200K tokens
- Message format: JSON with role/content
- Tool use: Supported via tool_use blocks

**Current Implementation**:

- Token budget guard: `src/token-budget-guard.ts`
- Context metrics: `scripts/utilities/context-metrics-report.ps1`

<!-- REF-OBSOLETA: scripts/utilities/context-metrics-report.ps1 no tiene equivalente TS (migración PS1→TS) -->

- Token telemetry: `scripts/utilities/token-telemetry.ps1`

<!-- REF-OBSOLETA: scripts/utilities/token-telemetry.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Optimizations Available**:

- Token efficiency matrix: `scripts/utilities/response-mode-efficiency-matrix.ps1`

<!-- REF-OBSOLETA: scripts/utilities/response-mode-efficiency-matrix.ps1 no tiene equivalente TS (migración PS1→TS) -->

- Context packing: `scripts/utilities/context-pack.ps1`

<!-- REF-OBSOLETA: scripts/utilities/context-pack.ps1 no tiene equivalente TS (migración PS1→TS) -->

- Handoff compression: `src/handoff-compress.ts`

<!-- REF-OBSOLETA: src/handoff-compress.ts no existe (ruta migrada o eliminada) -->

---

#### 2. Cline (VS Code Extension)

**Status**: FULLY SUPPORTED  
**versións**: Latest (compatible with Claude backend)  
**Integration Points**:

- VS Code extension API
- File operations: Read/Write/Execute
- Terminal integration: Command execution
- Context: Workspace-aware

**Current Implementation**:

- IDE session detection: `scripts/utilities/detect-ide-session.ps1`

<!-- REF-OBSOLETA: scripts/utilities/detect-ide-session.ps1 no tiene equivalente TS (migración PS1→TS) -->

- Response mode: `scripts/utilities/response-mode.ps1`

<!-- REF-OBSOLETA: scripts/utilities/response-mode.ps1 no tiene equivalente TS (migración PS1→TS) -->

- Enforce response mode: `scripts/utilities/enforce-response-mode.ps1`

<!-- REF-OBSOLETA: scripts/utilities/enforce-response-mode.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Optimizations Available**:

- Compact start: `scripts/utilities/compact-start.ps1`

<!-- REF-OBSOLETA: scripts/utilities/compact-start.ps1 no tiene equivalente TS (migración PS1→TS) -->

- Stack on demand: `scripts/utilities/stack-on-demand.ps1`

<!-- REF-OBSOLETA: scripts/utilities/stack-on-demand.ps1 no tiene equivalente TS (migración PS1→TS) -->

- Stack dashboard: `scripts/utilities/stack-dashboard.ps1`

<!-- REF-OBSOLETA: scripts/utilities/stack-dashboard.ps1 no tiene equivalente TS (migración PS1→TS) -->

---

#### 3. OpenCode (GitHub Copilot Integration)

**Status**: PARTIALLY SUPPORTED  
**versións**: Latest  
**Integration Points**:

- GitHub Copilot API
- Code completion
- Chat interface
- Context: File-based

**Current Implementation**:

- Native workspace tooling

**Limitations**:

- Token context: Limited to file scope
- Message format: Copilot-specific
- Tool use: Limited support

**Optimizations Needed**:

- Context compression for Copilot
- Message format adaptation
- Token budget constraints

---

#### 4. Continue.dev (IDE Extension)

**Status**: SUPPORTED  
**versións**: Latest  
**Integration Points**:

- IDE extension API
- Multiple LLM backends
- Chat interface
- Context: Project-aware

**Current Implementation**:

- Response mode: Compatible
- Context packing: Supported

**Optimizations Needed**:

- Backend-specific token handling
- Message format standardization

---

## Token Context Standardization

### Current Definitions

#### Token Budget Levels

```
TIER_1_MINIMAL = 5000 tokens
TIER_2_STANDARD = 15000 tokens
TIER_3_EXTENDED = 50000 tokens
TIER_4_MAXIMUM = 100000 tokens
TIER_5_UNLIMITED = 200000 tokens (Claude only)
```

#### Context Allocation

```
System Prompt: 10-15%
User Input: 20-30%
Conversation History: 30-40%
Tool Output: 15-25%
Reserved Buffer: 5-10%
```

#### Token Efficiency Modes

```
COMPACT = 60% token usage (prioritize speed)
BALANCED = 80% token usage (default)
COMPREHENSIVE = 95% token usage (prioritize quality)
MAXIMUM = 99% token usage (use all available)
```

---

### Input Message Standardization

#### Standard Format

```json
{
  "role": "user",
  "content": {
    "type": "text|file|command",
    "text": "User message",
    "context": {
      "tool": "cline|copilot|continue",
      "mode": "compact|balanced|comprehensive",
      "token_budget": 50000,
      "session_id": "uuid"
    },
    "metadata": {
      "timestamp": "ISO8601",
      "source": "IDE|CLI|API",
      "priority": "normal|high|critical"
    }
  }
}
```

#### Tool-Specific Adaptations

**Cline**:

```json
{
  "role": "user",
  "content": "User message",
  "cline_context": {
    "workspace_root": "/path/to/workspace",
    "open_files": ["file1.ps1", "file2.ps1"],
    "token_budget": 100000
  }
}
```

**Copilot**:

```json
{
  "role": "user",
  "content": "User message",
  "copilot_context": {
    "file": "current_file.ps1",
    "line": 42,
    "token_budget": 15000
  }
}
```

**Continue.dev**:

```json
{
  "role": "user",
  "content": "User message",
  "continue_context": {
    "backend": "claude|gpt4|local",
    "project_root": "/path/to/project",
    "token_budget": 50000
  }
}
```

---

### Output Message Standardization

#### Standard Format

```json
{
  "role": "assistant",
  "content": {
    "type": "text|code|action",
    "text": "Response text",
    "code_blocks": [
      {
        "language": "TypeScript",
        "content": "code here",
        "executable": true
      }
    ],
    "actions": [
      {
        "type": "file_write|file_read|command_execute",
        "target": "path/to/file",
        "content": "content here"
      }
    ],
    "metadata": {
      "tokens_used": 12345,
      "efficiency": "balanced",
      "execution_time": 1.234,
      "status": "success|warning|error"
    }
  }
}
```

#### Tool-Specific Adaptations

**Cline**:

```json
{
  "role": "assistant",
  "content": "Response text",
  "cline_actions": [
    {
      "type": "file_write|command_execute",
      "path": "/path/to/file",
      "content": "content"
    }
  ],
  "tokens_used": 12345
}
```

**Copilot**:

```json
{
  "role": "assistant",
  "content": "Response text",
  "suggestións": [
    {
      "text": "code suggestión",
      "range": [start, end]
    }
  ]
}
```

---

## Chat Protocol Standardization

### Session Management

#### Session Initialization

```TypeScript
# Standard session start
{
  "session_id": "uuid",
  "tool": "cline|copilot|continue",
  "timestamp": "ISO8601",
  "token_budget": 50000,
  "efficiency_mode": "balanced",
  "context_level": "project|workspace|file"
}
```

#### Session Termination

```TypeScript
# Standard session end
{
  "session_id": "uuid",
  "status": "completed|interrupted|error",
  "total_tokens_used": 45000,
  "total_time": 123.45,
  "artifacts": [
    {
      "type": "file|report|log",
      "path": "/path/to/artifact"
    }
  ]
}
```

### Message Flow

#### Turn-Based Conversation

```
1. User sends message with context
2. System evaluates token budget
3. AI processes with context window
4. AI sends response with metadata
5. System logs interaction
6. Next turn begins
```

#### Error Handling

```json
{
  "error": {
    "code": "TOKEN_BUDGET_EXCEEDED|CONTEXT_OVERFLOW|TOOL_ERROR",
    "message": "Human readable message",
    "recovery": "suggested action",
    "fallback_mode": "compact|minimal"
  }
}
```

---

## Message Format Definitions

### System Prompts

#### Standard System Prompt

```
You are an AI assistant integrated with Gentle-Vanguard.

CAPABILITIES:
- TypeScript scripting and execution
- File operations (read/write)
- Git operations
- Project management
- Code review and analysis

CONSTRAINTS:
- Token budget: [BUDGET] tokens
- Efficiency mode: [MODE]
- Context level: [LEVEL]
- Execution environment: [ENV]

GUIDELINES:
- Always validate scripts before execution
- Provide clear explanations
- Use structured output
- Report token usage
- Maintain session context
```

#### Tool-Specific System Prompts

**Cline**:

```
You are integrated with Cline VS Code extension.

CAPABILITIES:
- Full workspace access
- File read/write operations
- Terminal command execution
- Git integration
- IDE API access

CONSTRAINTS:
- Work within workspace root
- Respect .gitignore
- Validate before execution
- Report progress
```

**Copilot**:

```
You are integrated with GitHub Copilot.

CAPABILITIES:
- Code completion
- Code suggestións
- Chat interface
- File context awareness

CONSTRAINTS:
- Limited to file scope
- Reduced token budget
- Focus on code quality
- Provide concise responses
```

---

## Input Message Types

### Standard Input Types

#### Text Message

```json
{
  "type": "text",
  "content": "User message",
  "priority": "normal"
}
```

#### File Reference

```json
{
  "type": "file",
  "path": "/path/to/file",
  "action": "read|write|analyze",
  "context": "surrounding lines"
}
```

#### Command Execution

```json
{
  "type": "command",
  "command": "TypeScript command",
  "working_directory": "/path",
  "timeout": 30
}
```

#### Context Request

```json
{
  "type": "context_request",
  "scope": "project|workspace|file",
  "include": ["files", "git_status", "environment"]
}
```

---

## Output Message Types

### Standard Output Types

#### Text Response

```json
{
  "type": "text",
  "content": "Response text",
  "format": "plain|markdown|structured"
}
```

#### Code Block

```json
{
  "type": "code",
  "language": "TypeScript|bash|json",
  "content": "code here",
  "executable": true,
  "explanation": "what this does"
}
```

#### Action Request

```json
{
  "type": "action",
  "actions": [
    {
      "type": "file_write|file_read|command_execute",
      "target": "path/to/file",
      "content": "content"
    }
  ]
}
```

#### Status Report

```json
{
  "type": "status",
  "status": "success|warning|error",
  "message": "status message",
  "details": "additional information",
  "tokens_used": 12345,
  "next_steps": ["step1", "step2"]
}
```

---

## Compatibility Implementation

### Scripts for Tool Integration

#### Tool Detection

```TypeScript
# scripts/utilities/detect-ide-session.ps1
<!-- REF-OBSOLETA: scripts/utilities/detect-ide-session.ps1 no tiene equivalente TS (migración PS1→TS) -->
- Detects active IDE/tool
- Returns tool identifier
- Sets environment variables
```

#### Tool-Specific Routing

```TypeScript
# scripts/utilities/dispatch-agent.ps1
<!-- REF-OBSOLETA: scripts/utilities/dispatch-agent.ps1 no tiene equivalente TS (migración PS1→TS) -->
- Routes messages to correct tool
- Adapts message format
- Handles tool-specific features
```

#### Response Mode Management

```TypeScript
# scripts/utilities/response-mode.ps1
<!-- REF-OBSOLETA: scripts/utilities/response-mode.ps1 no tiene equivalente TS (migración PS1→TS) -->
- Manages efficiency modes
- Adapts token budgets
- Optimizes context usage
```

#### Token Management

```TypeScript
# src/token-budget-guard.ts
- Enforces token limits
- Tracks usage
- Prevents overflow
```

---

## Homologation Checklist

### For Each Tool Integration

- [ ] Define token budget tiers
- [ ] Create system prompt
- [ ] Define input message format
- [ ] Define output message format
- [ ] Implement error handling
- [ ] Create session management
- [ ] Add tool detection
- [ ] Implement message routing
- [ ] Add token tracking
- [ ] Create efficiency modes
- [ ] Document tool-specific features
- [ ] Test end-to-end workflow

---

## Current Implementation Status

### Implemented

- [x] Claude integration (full)
- [x] Cline integration (full)
- [x] Token budget system
- [x] Context packing
- [x] Response modes
- [x] Session management

### In Progress

- [ ] Copilot standardization
- [ ] Continue.dev adaptation
- [ ] Message format unification
- [ ] Error handling standardization

### Planned

- [ ] Additional tool integrations
- [ ] Advanced context optimization
- [ ] Multi-tool orchestration
- [ ] Unified dashboard

---

## Configuration Files

### Tool Configurations

#### Cline Configuration

```json
{
  "tool": "cline",
  "token_budget": 100000,
  "efficiency_mode": "balanced",
  "context_level": "workspace",
  "features": {
    "file_operations": true,
    "terminal_execution": true,
    "git_integration": true
  }
}
```

#### Copilot Configuration

```json
{
  "tool": "copilot",
  "token_budget": 15000,
  "efficiency_mode": "compact",
  "context_level": "file",
  "features": {
    "code_completion": true,
    "chat": true,
    "suggestións": true
  }
}
```

#### Continue.dev Configuration

```json
{
  "tool": "continue",
  "token_budget": 50000,
  "efficiency_mode": "balanced",
  "context_level": "project",
  "backends": ["claude", "gpt4", "local"],
  "features": {
    "chat": true,
    "code_editing": true,
    "multiple_backends": true
  }
}
```

---

## Next Steps

1. **Audit Current Implementations**
   - Review token context definitions
   - Document input/output formats
   - Identify inconsistencies

2. **Standardize Formats**
   - Create unified message schemas
   - Implement format adapters
   - Add validation

3. **Update Documentation**
   - Document all tool integrations
   - Create tool-specific guides
   - Add examples

4. **Test Compatibility**
   - Test each tool integration
   - Verify message formats
   - Validate token handling

5. **Deploy Updates**
   - Update scripts
   - Deploy configurations
   - Monitor compatibility

---

## Resources

- Token Budget Guard: `src/token-budget-guard.ts`
- Response Mode: `scripts/utilities/response-mode.ps1`

<!-- REF-OBSOLETA: scripts/utilities/response-mode.ps1 no tiene equivalente TS (migración PS1→TS) -->

- Context Pack: `scripts/utilities/context-pack.ps1`

<!-- REF-OBSOLETA: scripts/utilities/context-pack.ps1 no tiene equivalente TS (migración PS1→TS) -->

- Detect IDE Session: `scripts/utilities/detect-ide-session.ps1`

<!-- REF-OBSOLETA: scripts/utilities/detect-ide-session.ps1 no tiene equivalente TS (migración PS1→TS) -->

- Dispatch Agent: `scripts/utilities/dispatch-agent.ps1`

<!-- REF-OBSOLETA: scripts/utilities/dispatch-agent.ps1 no tiene equivalente TS (migración PS1→TS) -->
