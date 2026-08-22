---
name: monitoring-aggregator
description: Monitoring aggregation skill for collecting and analyzing workspace metrics
metadata:
  source: GV-native
---

# Skill: monitoring-aggregator

**versión**: 1.0.0 **Created**: 2026-04-20 **Status**: ACTIVE **Priority**: MEDIUM

---

## Overview

The `monitoring-aggregator` skill provides comprehensive metrics aggregation, analysis, and insights
from multiple data sources. It enables trend analysis, forecasting, and actionable recommendations
for system optimization.

### Key Capabilities

- Metrics aggregation from multiple sources
- Trend analysis and pattern recognition
- Forecasting and capacity planning
- Intelligent recommendations
- Visualization and reporting

---

## When to Use This Skill

### Activation Triggers

- User mentions "analyze metrics" or "analizar mtricas"
- User asks to "show trends" or "mostrar tendencias"
- User requests "predict resource usage" or "predecir uso de recursos"
- Regular monitoring reports needed
- Performance analysis required

---

## Core Components

### 1. Metrics Aggregation

#### CPU Usage Tracking

```powershell
function Get-CPUMetrics {
    param([int]$SampleCount = 10)

    $samples = @()
    for ($i = 0; $i -lt $SampleCount; $i++) {
        $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
        $samples += $cpu
        Start-Sleep -Seconds 1
    }

    return @{
        Average = ($samples | Measure-Object -Average).Average
        Peak = ($samples | Measure-Object -Maximum).Maximum
        Min = ($samples | Measure-Object -Minimum).Minimum
    }
}
```

#### Memory Consumption

```powershell
function Get-MemoryMetrics {
    $os = Get-CimInstance Win32_OperatingSystem
    $totalMemory = $os.TotalVisibleMemorySize * 1KB
    $freeMemory = $os.FreePhysicalMemory * 1KB
    $usedMemory = $totalMemory - $freeMemory
    $usagePercent = ($usedMemory / $totalMemory) * 100

    return @{
        TotalMemory = $totalMemory
        UsedMemory = $usedMemory
        FreeMemory = $freeMemory
        UsagePercent = [math]::Round($usagePercent, 2)
    }
}
```

#### Disk I/O Patterns

```powershell
function Get-DiskIOMetrics {
    param([string]$Drive = "C:")

    $diskMetrics = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk |
        Where-Object { $_.Name -match $Drive }

    return @{
        Drive = $Drive
        ReadBytesPerSec = $diskMetrics.DiskReadBytesPerSec
        WriteBytesPerSec = $diskMetrics.DiskWriteBytesPerSec
        PercentDiskTime = $diskMetrics.PercentDiskTime
    }
}
```

---

### 2. Trend Analysis

---

> **Referencia detallada**: [eferences/detail.md](references/detail.md)
