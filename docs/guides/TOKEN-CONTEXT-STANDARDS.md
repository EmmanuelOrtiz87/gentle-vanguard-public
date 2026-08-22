# Token Context Standards

**Date**: 2026-04-22  
**Status**: STANDARDIZATION IN PROGRESS  
**Purpose**: Define unified token context, message formats, and protocols

---

## Token Context Definitions

### Token Budget Tiers

#### Tier 1: Minimal (5,000 tokens)

**Use Case**: Quick responses, simple tasks  
**Allocation**:

- System Prompt: 500 tokens (10%)
- User Input: 1,000 tokens (20%)
- History: 1,500 tokens (30%)
- Tool Output: 1,000 tokens (20%)
- Buffer: 500 tokens (10%)

**Tools**: Copilot, quick interactions

---

#### Tier 2: Standard (15,000 tokens)

**Use Case**: Normal development tasks  
**Allocation**:

- System Prompt: 1,500 tokens (10%)
- User Input: 3,000 tokens (20%)
- History: 4,500 tokens (30%)
- Tool Output: 3,750 tokens (25%)
- Buffer: 1,750 tokens (15%)

**Tools**: Continue.dev, standard workflows

---

#### Tier 3: Extended (50,000 tokens)

**Use Case**: Complex analysis, large files  
**Allocation**:

- System Prompt: 5,000 tokens (10%)
- User Input: 10,000 tokens (20%)
- History: 15,000 tokens (30%)
- Tool Output: 12,500 tokens (25%)
- Buffer: 7,500 tokens (15%)

**Tools**: Cline, comprehensive tasks

---

#### Tier 4: Maximum (100,000 tokens)

**Use Case**: Full project context, deep analysis  
**Allocation**:

- System Prompt: 10,000 tokens (10%)
- User Input: 20,000 tokens (20%)
- History: 30,000 tokens (30%)
- Tool Output: 25,000 tokens (25%)
- Buffer: 15,000 tokens (15%)

**Tools**: Claude, project-wide analysis

---

#### Tier 5: Unlimited (200,000 tokens)

**Use Case**: Maximum context, Claude Opus only  
**Allocation**:

- System Prompt: 20,000 tokens (10%)
- User Input: 40,000 tokens (20%)
- History: 60,000 tokens (30%)
- Tool Output: 50,000 tokens (25%)
- Buffer: 30,000 tokens (15%)

**Tools**: Claude Opus, unlimited context

---

### Efficiency Modes

#### Compact Mode (60% utilization)

**Purpose**: Speed and cost optimization  
**Characteristics**:

- Minimal context history
- Concise responses
- Fast execution
- Lower token usage

**Use Cases**:

- Quick fixes
- Simple questions
- Time-sensitive tasks

**Configuration**:

```TypeScript
$mode = 'compact'
$token_budget = $tier * 0.60
$context_depth = 'minimal'
$response_style = 'concise'
```

---

#### Balanced Mode (80% utilization)

**Purpose**: Default mode, balance quality and efficiency  
**Characteristics**:

- Moderate context history
- Detailed responses
- Normal execution
- Reasonable token usage

**Use Cases**:

- Standard development
- Code review
- Problem solving

**Configuration**:

```TypeScript
$mode = 'balanced'
$token_budget = $tier * 0.80
$context_depth = 'moderate'
$response_style = 'detailed'
```

---

#### Comprehensive Mode (95% utilization)

**Purpose**: Quality optimization  
**Characteristics**:

- Full context history
- Thorough responses
- Slower execution
- Higher token usage

**Use Cases**:

- Complex analysis
- Architecture design
- Comprehensive review

**Configuration**:

```TypeScript
$mode = 'comprehensive'
$token_budget = $tier * 0.95
$context_depth = 'full'
$response_style = 'thorough'
```

---

#### Maximum Mode (99% utilization)

**Purpose**: Use all available context  
**Characteristics**:

- Complete context history
- Exhaustive responses
- Slowest execution
- Maximum token usage

**Use Cases**:

- Critical decisións
- Full project analysis
- Comprehensive documentation

**Configuration**:

```TypeScript
$mode = 'maximum'
$token_budget = $tier * 0.99
$context_depth = 'complete'
$response_style = 'exhaustive'
```

---

## Message Format Standards

### Input Message Structure

#### Standard Schema

```json
{
  "versión": "1.0",
  "session_id": "uuid",
  "timestamp": "ISO8601",
  "role": "user",
  "content": {
    "type": "text|file|command|context_request",
    "text": "message content",
    "priority": "normal|high|critical"
  },
  "context": {
    "tool": "cline|copilot|continue|claude",
    "mode": "compact|balanced|comprehensive|maximum",
    "token_budget": 50000,
    "efficiency_target": 0.8
  },
  "metadata": {
    "source": "IDE|CLI|API",
    "environment": "development|production",
    "session_duration": 123.45
  }
}
```

#### Validation Rules

- `versión`: Must be "1.0"
- `session_id`: Must be valid UUID
- `timestamp`: Must be ISO8601 format
- `role`: Must be "user"
- `content.type`: Must be valid type
- `context.tool`: Must be supported tool
- `context.mode`: Must be valid mode

---

### Output Message Structure

#### Standard Schema

```json
{
  "versión": "1.0",
  "session_id": "uuid",
  "timestamp": "ISO8601",
  "role": "assistant",
  "content": {
    "type": "text|code|action|status",
    "text": "response content",
    "format": "plain|markdown|json"
  },
  "execution": {
    "status": "success|warning|error",
    "tokens_used": 12345,
    "efficiency": 0.75,
    "execution_time": 1.234
  },
  "metadata": {
    "tool": "cline|copilot|continue|claude",
    "mode": "compact|balanced|comprehensive|maximum",
    "next_steps": ["step1", "step2"]
  }
}
```

#### Validation Rules

- `versión`: Must be "1.0"
- `session_id`: Must match input
- `timestamp`: Must be ISO8601 format
- `role`: Must be "assistant"
- `execution.status`: Must be valid status
- `execution.tokens_used`: Must be integer
- `execution.efficiency`: Must be 0.0-1.0

---

## Chat Protocol Standards

### Session Lifecycle

#### 1. Session Initialization

```json
{
  "action": "session_start",
  "session_id": "uuid",
  "tool": "cline",
  "token_budget": 50000,
  "efficiency_mode": "balanced",
  "context_level": "workspace",
  "timestamp": "ISO8601"
}
```

#### 2. Message Exchange

```json
{
  "action": "message_exchange",
  "session_id": "uuid",
  "turn": 1,
  "user_message": {...},
  "assistant_response": {...},
  "tokens_used": 12345
}
```

#### 3. Context Update

```json
{
  "action": "context_update",
  "session_id": "uuid",
  "context_changes": [...],
  "tokens_freed": 5000,
  "tokens_used": 12345
}
```

#### 4. Session Termination

```json
{
  "action": "session_end",
  "session_id": "uuid",
  "status": "completed|interrupted|error",
  "total_tokens_used": 45000,
  "total_time": 123.45,
  "artifacts": [...]
}
```

---

### Error Handling Protocol

#### Token Budget Exceeded

```json
{
  "error": {
    "code": "TOKEN_BUDGET_EXCEEDED",
    "message": "Token budget exceeded",
    "current_usage": 50000,
    "budget": 50000,
    "recovery": "compact_mode|compress_context|new_session",
    "recommended_action": "Switch to compact mode"
  }
}
```

#### Context Overflow

```json
{
  "error": {
    "code": "CONTEXT_OVERFLOW",
    "message": "Context exceeds tool limits",
    "current_size": 100000,
    "limit": 50000,
    "recovery": "compress_context|split_session",
    "recommended_action": "Compress context or start new session"
  }
}
```

#### Tool Error

```json
{
  "error": {
    "code": "TOOL_ERROR",
    "message": "Tool execution failed",
    "tool": "cline",
    "details": "error details",
    "recovery": "retry|fallback_tool|manual_action",
    "recommended_action": "Retry or switch tool"
  }
}
```

---

## Implementation Scripts

### Token Management

```TypeScript
# src/token-budget-guard.ts
- Enforces token limits
- Tracks usage
- Prevents overflow
- Manages efficiency modes
```

### Context Optimization

```TypeScript
# scripts/utilities/context-pack.ps1
<!-- REF-OBSOLETA: scripts/utilities/context-pack.ps1 no tiene equivalente TS (migración PS1→TS) -->
- Compresses context
- Removes redundancy
- Optimizes structure
- Maximizes efficiency
```

### Tool Integration

```TypeScript
# scripts/utilities/dispatch-agent.ps1
<!-- REF-OBSOLETA: scripts/utilities/dispatch-agent.ps1 no tiene equivalente TS (migración PS1→TS) -->
- Routes to correct tool
- Adapts message format
- Handles tool-specific features
- Manages compatibility
```

### Session Management

```TypeScript
# src/session-manager.ts
- Creates sessions
- Tracks state
- Manages lifecycle
- Handles cleanup
```

---

## Configuration Examples

### Cline Configuration

```TypeScript
$config = @{
    tool = 'cline'
    token_budget = 100000
    efficiency_mode = 'balanced'
    context_level = 'workspace'
    features = @{
        file_operations = $true
        terminal_execution = $true
        git_integration = $true
    }
}
```

### Copilot Configuration

```TypeScript
$config = @{
    tool = 'copilot'
    token_budget = 15000
    efficiency_mode = 'compact'
    context_level = 'file'
    features = @{
        code_completion = $true
        chat = $true
        suggestións = $true
    }
}
```

### Continue.dev Configuration

```TypeScript
$config = @{
    tool = 'continue'
    token_budget = 50000
    efficiency_mode = 'balanced'
    context_level = 'project'
    backends = @('claude', 'gpt4', 'local')
    features = @{
        chat = $true
        code_editing = $true
        multiple_backends = $true
    }
}
```

---

## Validation & Testing

### Message Validation

```TypeScript
function Validate-Message {
    param([object]$Message, [string]$Type)

    # Validate schema
    # Check required fields
    # Verify formats
    # Test constraints
}
```

### Token Calculation

```TypeScript
function Calculate-TokenUsage {
    param([object]$Message)

    # Count tokens
    # Apply efficiency mode
    # Check budget
    # Return usage
}
```

### Compatibility Check

```TypeScript
function Check-ToolCompatibility {
    param([string]$Tool, [object]$Message)

    # Verify tool support
    # Check message format
    # Validate constraints
    # Return compatibility
}
```

---

## Best Practices

1. **Always validate messages** before processing
2. **Track token usage** in every interaction
3. **Respect efficiency modes** for optimization
4. **Handle errors gracefully** with recovery options
5. **Log all interactions** for debugging
6. **Test compatibility** before deployment
7. **Document tool-specific features** clearly
8. **Maintain session state** consistently

---

## Resources

- Token Budget Guard: `src/token-budget-guard.ts`
- Context Pack: `scripts/utilities/context-pack.ps1`

<!-- REF-OBSOLETA: scripts/utilities/context-pack.ps1 no tiene equivalente TS (migración PS1→TS) -->

- Dispatch Agent: `scripts/utilities/dispatch-agent.ps1`

<!-- REF-OBSOLETA: scripts/utilities/dispatch-agent.ps1 no tiene equivalente TS (migración PS1→TS) -->

- Session Manager: `src/session-manager.ts`
