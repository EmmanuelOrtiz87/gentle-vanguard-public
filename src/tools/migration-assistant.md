# Migration Analysis Assistant

## Overview

Tool for analyzing and assisting PS1→TS migrations.

## Features

- Parse PowerShell AST
- Identify patterns needing conversion
- Generate TypeScript equivalents
- Track migration progress

## Usage

```typescript
import { analyzePowerShell } from './ps1-analyzer';
const result = analyzePowerShell('Get-ChildItem *.ts');
```

## Integration

Part of Gentle-Vanguard migration toolkit.
