---
name: cross-workspace-sync
description: Cross-workspace synchronization skill for maintaining consistency across projects
metadata:
  source: GV-native
---

# Skill: cross-workspace-sync

**versión**: 1.0.0 **Created**: 2026-04-20 **Status**: ACTIVE **Priority**: MEDIUM

---

## Overview

The `cross-workspace-sync` skill provides intelligent synchronization between multiple workspaces
with advanced conflict resolution and consistency validation. It enables seamless data replication
across workspace boundaries.

### Key Capabilities

- Multiple sync modes (One-way, Two-way, Selective, Smart)
- Intelligent conflict resolution strategies
- Advanced change detection
- Pre/Post sync validation
- Consistency monitoring and drift detection

---

## When to Use This Skill

### Activation Triggers

- User mentions "sync workspaces" or "sincronizar workspaces"
- User asks to "resolve conflict" or "resolver conflicto"
- Working with multiple workspaces simultaneously
- Consistency validation needed
- Cross-workspace data migration

### Use Cases

1. **Multi-Workspace Sync**: "Sincronizar datos entre workspace A y B"
2. **Conflict Resolution**: "Hay conflictos en la sincronizacin, cmo resolver?"
3. **Selective Sync**: "Sincronizar solo archivos .config entre workspaces"
4. **Consistency Check**: "Verificar que los datos estn sincronizados"
5. **Automated Monitoring**: "Monitorear cambios entre workspaces"

---

## Core Components

### 1. Sync Modes

#### One-Way Sync

```powershell
$syncConfig = @{
    Mode = "OneWay"
    Source = "C:\Workspace-A"
    Destination = "C:\Workspace-B"
    Direction = "Forward"
    DeleteMissing = $false
    Overwrite = $true
}
```

#### Two-Way Sync

```powershell
$syncConfig = @{
    Mode = "TwoWay"
    Workspace1 = "C:\Workspace-A"
    Workspace2 = "C:\Workspace-B"
    ConflictStrategy = "Newest-Wins"
    PreserveDeletes = $true
}
```

#### Selective Sync

```powershell
$syncConfig = @{
    Mode = "Selective"
    Source = "C:\Workspace-A"
    Destination = "C:\Workspace-B"
    IncludePatterns = @("*.config", "*.json", "*.yaml")
    ExcludePatterns = @("*.tmp", "*.log", ".git*")
    Recursive = $true
}
```

#### Smart Sync

```powershell
$syncConfig = @{
    Mode = "Smart"
    Workspace1 = "C:\Workspace-A"
    Workspace2 = "C:\Workspace-B"
    ChangeDetection = "Hash"
    IncrementalOnly = $true
    DeltaSync = $true
}
```

---

---

> **Referencia detallada**: [eferences/detail.md](references/detail.md)
