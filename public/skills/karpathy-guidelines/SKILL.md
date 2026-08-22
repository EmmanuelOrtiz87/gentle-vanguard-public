---
name: karpathy-guidelines
description: >
  Four principles for LLM coding excellence (Andrej Karpathy inspired). Trigger: When writing code,
  refactoring, or implementing features.
metadata:
  source: GV-native
---

# Skill: karpathy-guidelines

## Trigger Conditions

- When writing code, refactoring, or implementing features
- When the LLM might overcomplicate, assume, or make orthogonal changes
- When user asks for "clean code", "simple solution", or "minimal changes"
- When reviewing PRs or code quality

## Skill Instructions

### Core Principles (Non-negotiable)

**1. Think Before Coding**

- State assumptions explicitly before implementing
- Present multiple interpretations if ambiguity exists
- Push back when a simpler approach exists
- Stop and ask when confused - don't hide confusion

**2. Simplicity First**

- Minimum code that solves the problem
- No features beyond what was asked
- No abstractions for single-use code
- No speculative "flexibility" or "configurability"
- Test: "Would a senior engineer say this is overcomplicated?"

**3. Surgical Changes**

- Touch only what you must
- Don't "improve" adjacent code, comments, or formatting
- Match existing style, even if you'd do it differently
- Remove only YOUR orphans (imports/variables/functions your changes made unused)
- Test: Every changed line should trace directly to the user's request

**4. Goal-Driven Execution**

- Transform imperative tasks into verifiable goals
- State success criteria before implementing
- For multi-step tasks, state plan with verification steps:

  ```
  1. [Step] → verify: [check]
  2. [Step] → verify: [check]
  ```

- Loop until verified (don't ask "is this ok?" - verify objectively)

### Integration with Gentle-Vanguard

**Orchestrator Integration:**

- Auto-detect violations of these principles
- Trigger warnings when code is overcomplicated (>200 lines when 50 would do)
- Flag orthogonal edits (changes not traceable to user request)
- Measure: lines-changed vs. request-complexity ratio

**Failure Learning System:**

- Record violations as learnings
- Build patterns: "This type of task often triggers overcomplication"
- Auto-suggest: "Last time you overcomplicated X, try simpler approach"

**Norm Enforcement:**

- Add to auto-norm-enforcer.ps1 as "karpathy-norms"
- Check: Is code minimal? Are changes surgical? Are goals defined?
- Auto-fix: Suggest simplifications, remove orthogonal changes

### Success Criteria for this Skill

1. **Fewer unnecessary changes** - Only requested changes in diffs
2. **Minimal code** - Senior engineer would not say "overcomplicated"
3. **Clarifying questions first** - Before implementation, not after
4. **Clean PRs** - No drive-by refactoring or "improvements"
5. **Verifiable goals** - Every task has success criteria

### Project-Specific Adaptations

When active, this skill:

- Reads existing code style and matches it strictly
- Uses Gentle-Vanguard's failure-learning-system to improve over time
- Reports violations to engram with tag "karpathy-violation"
- Integrates with judgment-day-orchestrator for code quality gates

### Usage Example

**User**: "Add validation to the form" **Bad**: Immediately writes 200 lines of validation framework
**Good** (Karpathy skill active):

1. States assumption: "I'll validate required fields only"
2. Asks: "Should I validate format (email, phone) too?"
3. Writes minimal code (20 lines)
4. Defines success: "Form rejects empty fields, accepts valid input"
5. Verifies by testing the form

## References

- Original: https://github.com/forrestchang/andrej-karpathy-skills
- Andrej Karpathy's post: https://x.com/karpathy/status/2015883857489522876
- Gentle-Vanguard integration: See judgment-day-orchestrator.ps1, failure-learning-system.ps1
