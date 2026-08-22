---
name: playwright
description: >
  Playwright E2E testing patterns. Trigger: When writing E2E tests - Page Objects, selectors, MCP
  workflow.
license: Apache-2.0
metadata:
  author: gentle-vanguard
  versión: '1.1'
metadata:
  source: GV-native
---

## MCP Workflow (MANDATORY If Available)

**If you have Playwright MCP tools, ALWAYS use them BEFORE creating any test:**

1. **Navigate** to target page
2. **Take snapshot** to see page structure and elements
3. **Interact** with forms/elements to verify exact user flow
4. **Take screenshots** to document expected states
5. **Verify page transitions** through complete flow (loading, success, error)
6. **Document actual selectors** from snapshots (use real refs and labels)
7. **Only after exploring** create test code with verified selectors

**If MCP NOT available:** Proceed with test creation based on docs and code analysis.

**Why This Matters:**

- Precise tests - exact steps needed, no assumptions
- Accurate selectors - real DOM structure, not imagined
- Real flow validation - verify journey actually works
- Avoid over-engineering - minimal tests for what exists
- Prevent flaky tests - real exploration = stable tests
- Never assume how UI "should" work

## File Structure

```
tests/
 base-page.ts              # Parent class for ALL pages
 helpers.ts                # Shared utilities
 {page-name}/
     {page-name}-page.ts   # Page Object Model
     {page-name}.spec.ts   # ALL tests here (NO separate files!)
     {page-name}.md        # Test documentation
```

**File Naming:**

- `sign-up.spec.ts` (all sign-up tests)
- `sign-up-page.ts` (page object)
- `sign-up.md` (documentation)
- `sign-up-critical-path.spec.ts` (WRONG - no separate files)
- `sign-up-validation.spec.ts` (WRONG)

## Selector Priority (REQUIRED)

```typescript
// 1. BEST - getByRole for interactive elements
this.submitButton = page.getByRole('button', { name: 'Submit' });
this.navLink = page.getByRole('link', { name: 'Dashboard' });

// 2. BEST - getByLabel for form controls
this.emailInput = page.getByLabel('Email');
this.passwordInput = page.getByLabel('Password');

// 3. SPARINGLY - getByText for static content only
this.errorMessage = page.getByText('Invalid credentials');
this.pageTitle = page.getByText('Welcome');

// 4. LAST RESORT - getByTestId when above fail
this.customWidget = page.getByTestId('date-picker');

//  AVOID fragile selectors
this.button = page.locator('.btn-primary'); // NO
this.input = page.locator('#email'); // NO
```

## Scope Detection (ASK IF AMBIGUOUS)

| User Says                                                          | Action                             |
| ------------------------------------------------------------------ | ---------------------------------- |
| "a test", "one test", "new test", "add test"                       | Create ONE test() in existing spec |
| "comprehensive tests", "all tests", "test suite", "generate tests" | Create full suite                  |

**Examples:**

- "Create a test for user sign-up" ONE test only
- "Generate E2E tests for login page" Full suite
- "Add a test to verify form validation" ONE test to existing spec

## Page Object Pattern

```typescript
import { Page, Locator, expect } from '@playwright/test';

// BasePage - ALL pages extend this
export class BasePage {
  constructor(protected page: Page) {}

  async goto(path: string): Promise<void> {
    await this.page.goto(path);
    await this.page.waitForLoadState('networkidle');
  }

  // Common methods go here (see Refactoring Guidelines)
  async waitForNotification(): Promise<void> {
    await this.page.waitForSelector('[role="status"]');
  }

  async verifyNotificationMessage(message: string): Promise<void> {

---

> **Referencia detallada**: [
eferences/detail.md](references/detail.md)
```
