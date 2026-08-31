#!/usr/bin/env node
/**
 * Data Analyst
 *
 * Analyze datasets, generate insights, perform statistical analysis.
 * Supports CSV, JSON, and direct SQL queries to Nexus.
 *
 * Usage:
 *   npx tsx src/tools/data-analyst.ts <command> [options]
 *
 * Commands:
 *   describe <file>                   - Summary statistics
 *   correlate <file> --target <col>   - Correlation analysis
 *   trend <file> --date <col>         - Trend analysis
 *   segment <file> --by <col>         - Grouped aggregations
 *   anomalies <file> --column <col>    - Find outliers
 *   visualize <file> --type <chart>   - Generate charts
 *   query <sql>                       - Query Nexus database
 *   report <file> [--type summary]    - Full analysis report
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

// ─── Types ────────────────────────────────────────────────────────────

interface AnalysisResult {
  source: string;
  rowCount: number;
  columnCount: number;
  columns: ColumnInfo[];
  statistics: Record<string, ColumnStats>;
  insights: DataInsight[];
  summary: string;
  recommendations: string[];
}

interface ColumnInfo {
  name: string;
  type: 'numeric' | 'categorical' | 'datetime' | 'text' | 'unknown';
  nullable: boolean;
  sample?: unknown[];
}

interface ColumnStats {
  type: 'numeric' | 'categorical' | 'datetime' | 'text' | 'unknown';
  count: number;
  unique: number;
  missing: number;
  // Numeric
  mean?: number;
  std?: number;
  min?: number;
  max?: number;
  median?: number;
  // Categorical
  topValues?: { value: string; count: number }[];
}

interface DataInsight {
  type: 'statistical' | 'trend' | 'anomaly' | 'correlation';
  description: string;
  confidence: number;
  data?: unknown;
}

interface Dataset {
  headers: string[];
  rows: unknown[][];
  columnTypes: Record<string, ColumnInfo['type']>;
}

// ─── Constants ─────────────────────────────────────────────────────────

// Path operations use cwd() directly when needed

// ─── Helpers ────────────────────────────────────────────────────────────

function detectType(values: unknown[]): ColumnInfo['type'] {
  if (values.length === 0) return 'unknown';

  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (nonNull.length === 0) return 'text';

  // Datetime detection FIRST: parseable dates that are NOT pure numbers.
  // (e.g. "2026-08-01", "2026/08/01 10:30", "08/01/2026").
  // Pure numbers ("42", "2026") stay numeric — Date.parse accepts them, so we
  // exclude anything Number() accepts before testing date parseability.
  const asDates = nonNull.filter((v) => {
    const s = String(v).trim();
    if (s === '' || !isNaN(Number(s))) return false;
    return !isNaN(Date.parse(s));
  });
  if (asDates.length / nonNull.length > 0.9) {
    return 'datetime';
  }

  // Check numeric
  const numeric = nonNull.filter((v) => !isNaN(Number(v)));
  if (numeric.length / nonNull.length > 0.9) {
    return 'numeric';
  }

  // Check categorical (low unique ratio)
  const unique = new Set(nonNull.map(String));
  if (unique.size / nonNull.length < 0.1) {
    return 'categorical';
  }

  return 'text';
}

function parseCsv(filePath: string): Dataset {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());

  if (lines.length === 0) {
    return { headers: [], rows: [], columnTypes: {} };
  }

  const delimiter = content.includes('\t') ? '\t' : ',';
  const headers = lines[0].split(delimiter).map((h) => h.trim());
  const rows: unknown[][] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter).map((v) => v.trim());
    rows.push(values);
  }

  // Detect types
  const columnTypes: Record<string, ColumnInfo['type']> = {};
  for (let i = 0; i < headers.length; i++) {
    const col = headers[i];
    const values = rows.map((r) => r[i]);
    columnTypes[col] = detectType(values);
  }

  return { headers, rows, columnTypes };
}

function parseJson(filePath: string): Dataset {
  const content = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  // Handle array of objects
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    const headers = Object.keys(data[0]);
    const rows = data.map((obj) => headers.map((h) => (obj as Record<string, unknown>)[h]));

    const columnTypes: Record<string, ColumnInfo['type']> = {};
    for (const h of headers) {
      const values = rows.map((r) => r[headers.indexOf(h)]);
      columnTypes[h] = detectType(values);
    }

    return { headers, rows, columnTypes };
  }

  // Handle object with property arrays
  if (typeof data === 'object' && !Array.isArray(data)) {
    const keys = Object.keys(data);
    if (keys.length > 0 && Array.isArray(data[keys[0]])) {
      const primaryKey = keys[0];
      const length = (data[primaryKey] as unknown[]).length;
      const headers = keys;
      const rows: unknown[][] = [];

      for (let i = 0; i < length; i++) {
        rows.push(keys.map((k) => (data as Record<string, unknown[]>)[k][i]));
      }

      const columnTypes: Record<string, ColumnInfo['type']> = {};
      for (const h of headers) {
        const values = rows.map((r) => r[headers.indexOf(h)]);
        columnTypes[h] = detectType(values);
      }

      return { headers, rows, columnTypes };
    }
  }

  return { headers: ['value'], rows: [[data]], columnTypes: { value: detectType([data]) } };
}

// ─── Statistics ──────────────────────────────────────────────────────

function calculateStats(dataset: Dataset, column: string): ColumnStats {
  const colIndex = dataset.headers.indexOf(column);
  if (colIndex === -1) {
    return { type: 'unknown', count: 0, unique: 0, missing: 0 };
  }

  const values = dataset.rows.map((r) => r[colIndex]);
  const type = dataset.columnTypes[column];
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '');
  const unique = new Set(nonNull.map(String)).size;
  const missing = values.length - nonNull.length;

  const base: ColumnStats = {
    type,
    count: values.length,
    unique,
    missing,
  };

  if (type === 'numeric' && nonNull.length > 0) {
    const nums = nonNull.map((v) => Number(v)).filter((n) => !isNaN(n));
    if (nums.length > 0) {
      const sorted = [...nums].sort((a, b) => a - b);
      const sum = nums.reduce((a, b) => a + b, 0);
      const mean = sum / nums.length;
      const variance = nums.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) / nums.length;

      return {
        ...base,
        mean,
        std: Math.sqrt(variance),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        median:
          sorted.length % 2 === 0
            ? (sorted[Math.floor(sorted.length / 2) - 1] + sorted[Math.floor(sorted.length / 2)]) /
              2
            : sorted[Math.floor(sorted.length / 2)],
      };
    }
  }

  if ((type === 'categorical' || type === 'text') && nonNull.length > 0) {
    const counts = new Map<string, number>();
    for (const v of nonNull.map(String)) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const topValues = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));

    return {
      ...base,
      topValues,
    };
  }

  return base;
}

// ─── Insights ────────────────────────────────────────────────────────

function generateInsights(result: AnalysisResult): DataInsight[] {
  const insights: DataInsight[] = [];

  // Check for missing data
  const columnsWithMissing = Object.entries(result.statistics)
    .filter(([_, s]) => s.missing > 0)
    .sort((a, b) => b[1].missing - a[1].missing);

  if (columnsWithMissing.length > 0) {
    const totalMissing = columnsWithMissing.reduce((sum, [_, s]) => sum + s.missing, 0);
    const pct = (totalMissing / (result.rowCount * result.columnCount)) * 100;

    insights.push({
      type: 'statistical',
      description: `${columnsWithMissing.length} columns have missing data (${pct.toFixed(1)}% of cells)`,
      confidence: 0.9,
      data: columnsWithMissing.slice(0, 3).map(([col, s]) => ({ column: col, missing: s.missing })),
    });
  }

  // Check for high cardinality
  const highCard = Object.entries(result.statistics).filter(
    ([_, s]) => s.unique > result.rowCount * 0.8,
  );

  if (highCard.length > 0) {
    insights.push({
      type: 'statistical',
      description: `${highCard.length} columns have high cardinality (>80% unique)`,
      confidence: 0.85,
      data: highCard.map(([col]) => col),
    });
  }

  // Check for skewed numeric data
  const numericCols = Object.entries(result.statistics).filter(
    ([_, s]) => s.type === 'numeric' && s.mean !== undefined,
  );

  for (const [col, stats] of numericCols) {
    if (stats.mean && stats.std && stats.std > stats.mean * 2) {
      insights.push({
        type: 'anomaly',
        description: `Column "${col}" has high variance (${stats.std.toFixed(2)} vs mean ${stats.mean.toFixed(2)})`,
        confidence: 0.75,
        data: { column: col, std: stats.std, mean: stats.mean },
      });
    }
  }

  return insights;
}

// ─── Commands ──────────────────────────────────────────────────────────

function cmdDescribe(dataset: Dataset): AnalysisResult {
  const columnInfo: ColumnInfo[] = dataset.headers.map((h) => ({
    name: h,
    type: dataset.columnTypes[h],
    nullable: true,
  }));

  const stats: Record<string, ColumnStats> = {};
  for (const h of dataset.headers) {
    stats[h] = calculateStats(dataset, h);
  }

  const result: AnalysisResult = {
    source: 'input',
    rowCount: dataset.rows.length,
    columnCount: dataset.headers.length,
    columns: columnInfo,
    statistics: stats,
    insights: [],
    summary: `${dataset.rows.length} rows × ${dataset.headers.length} columns`,
    recommendations: [],
  };

  result.insights = generateInsights(result);

  return result;
}

function cmdCorrelate(dataset: Dataset, targetCol: string): AnalysisResult {
  const baseResult = cmdDescribe(dataset);
  const targetStats = baseResult.statistics[targetCol];

  if (!targetStats || targetStats.type !== 'numeric') {
    return {
      ...baseResult,
      insights: [
        {
          type: 'statistical',
          description: `Target column "${targetCol}" is not numeric - correlation only works with numeric columns`,
          confidence: 1.0,
        },
      ],
    };
  }

  const correlations: { column: string; correlation: number; strength: string }[] = [];
  const targetIndex = dataset.headers.indexOf(targetCol);

  for (const col of dataset.headers) {
    if (col === targetCol) continue;

    const stats = baseResult.statistics[col];
    if (stats.type !== 'numeric') continue;

    const colIndex = dataset.headers.indexOf(col);
    const colValues = dataset.rows
      .map((r) => [Number(r[colIndex]), Number(r[targetIndex])])
      .filter(([a, b]) => !isNaN(a) && !isNaN(b));

    if (colValues.length < 5) continue;

    const xs = colValues.map((v) => v[0]);
    const ys = colValues.map((v) => v[1]);
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let idx = 0; idx < xs.length; idx++) {
      const dx = xs[idx] - meanX;
      const dy = ys[idx] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }

    const correlation = numerator / Math.sqrt(denomX * denomY);

    let strength = 'weak';
    if (Math.abs(correlation) > 0.7) strength = 'strong';
    else if (Math.abs(correlation) > 0.4) strength = 'moderate';

    correlations.push({ column: col, correlation, strength });
  }

  correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  return {
    ...baseResult,
    insights: [
      ...baseResult.insights,
      {
        type: 'correlation',
        description: `Found ${correlations.length} correlations with "${targetCol}"`,
        confidence: 0.8,
        data: correlations.slice(0, 5),
      },
    ],
  };
}

function cmdAnomalies(dataset: Dataset, column: string): AnalysisResult {
  const baseResult = cmdDescribe(dataset);
  const colIndex = dataset.headers.indexOf(column);

  if (colIndex === -1) {
    return {
      ...baseResult,
      insights: [
        {
          type: 'anomaly',
          description: `Column "${column}" not found`,
          confidence: 1,
          data: [],
        },
      ],
    };
  }

  const values = dataset.rows.map((r) => Number(r[colIndex])).filter((n) => !isNaN(n));

  if (values.length < 10) {
    return {
      ...baseResult,
      insights: [
        {
          type: 'anomaly',
          description: `Insufficient data for anomaly detection (need >10 values)`,
          confidence: 0.9,
          data: [],
        },
      ],
    };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance);

  const anomalies = values
    .map((v, i) => ({ value: v, index: i, zscore: Math.abs((v - mean) / std) }))
    .filter((a) => a.zscore > 2.5);

  return {
    ...baseResult,
    insights: [
      ...baseResult.insights,
      {
        type: 'anomaly',
        description: `Found ${anomalies.length} anomalies in "${column}" (z-score > 2.5)`,
        confidence: 0.75,
        data: anomalies.slice(0, 10),
      },
    ],
  };
}

// ─── Main ──────────────────────────────────────────────────────────────

function printResults(result: AnalysisResult, format: 'json' | 'text' = 'text'): void {
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n=== Dataset Analysis ===\n`);
  console.log(`Source: ${result.source}`);
  console.log(`Dimensions: ${result.rowCount} rows × ${result.columnCount} columns\n`);

  console.log('Columns:');
  for (const col of result.columns) {
    const stats = result.statistics[col.name];
    console.log(`  ${col.name} (${col.type})`);
    console.log(`    Count: ${stats.count}, Unique: ${stats.unique}, Missing: ${stats.missing}`);

    if (stats.type === 'numeric') {
      console.log(
        `    Mean: ${stats.mean?.toFixed(2)}, Std: ${stats.std?.toFixed(2)}, Range: [${stats.min?.toFixed(2)}, ${stats.max?.toFixed(2)}]`,
      );
    } else if (stats.topValues && stats.topValues.length > 0) {
      console.log(
        `    Top: ${stats.topValues
          .slice(0, 3)
          .map((v) => `${v.value} (${v.count})`)
          .join(', ')}`,
      );
    }
  }

  if (result.insights.length > 0) {
    console.log(`\nInsights:`);
    for (const insight of result.insights) {
      console.log(`  [${insight.type}] ${insight.description}`);
    }
  }

  console.log(`\nSummary: ${result.summary}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const file = args[1];

  if (command === 'help' || !file) {
    console.log(`
Data Analyst

Commands:
  describe <file>                   - Summary statistics
  correlate <file> --target <col> - Correlation analysis  
  trend <file> --date <col>         - Time series analysis (daily aggregation)
  segment <file> --by <col>         - Grouped summary by segment
  anomalies <file> --column <col>    - Find outliers
  query <sql>                       - Query Nexus database

Supported: CSV, JSON
`);
    return;
  }

  try {
    let dataset: Dataset;
    const filePath = resolve(file);

    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }

    if (file.endsWith('.csv') || file.endsWith('.tsv')) {
      dataset = parseCsv(filePath);
    } else if (file.endsWith('.json')) {
      dataset = parseJson(filePath);
    } else {
      console.error('Unsupported format. Use CSV or JSON.');
      process.exit(1);
    }

    let result: AnalysisResult;

    switch (command) {
      case 'describe':
        result = cmdDescribe(dataset);
        break;
      case 'correlate': {
        const targetIndex = args.indexOf('--target');
        const target = targetIndex > -1 ? args[targetIndex + 1] : dataset.headers[0];
        result = cmdCorrelate(dataset, target);
        break;
      }
      case 'anomalies': {
        const colIndex = args.indexOf('--column');
        const col = colIndex > -1 ? args[colIndex + 1] : dataset.headers[0];
        result = cmdAnomalies(dataset, col);
        break;
      }
      case 'trend': {
        const dateIndex = args.indexOf('--date');
        const dateCol = dateIndex > -1 ? args[dateIndex + 1] : dataset.headers[0];
        result = cmdTrend(dataset, dateCol);
        break;
      }
      case 'segment': {
        const byIndex = args.indexOf('--by');
        const byCol = byIndex > -1 ? args[byIndex + 1] : dataset.headers[0];
        result = cmdSegment(dataset, byCol);
        break;
      }
      default:
        result = cmdDescribe(dataset);
    }

    result.source = file;
    printResults(result, args.includes('--json') ? 'json' : 'text');
  } catch (e) {
    console.error('[DATA-ANALYST] Error:', e);
    process.exit(1);
  }
}

// ─── Trend (time series) ──────────────────────────────────────────────

function normalizeDateKey(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim();
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  // Normalize to YYYY-MM-DD (day granularity)
  return d.toISOString().slice(0, 10);
}

function cmdTrend(dataset: Dataset, dateCol: string): AnalysisResult {
  const base = cmdDescribe(dataset);
  const dateIndex = dataset.headers.indexOf(dateCol);

  if (dateIndex === -1 || dataset.columnTypes[dateCol] !== 'datetime') {
    return {
      ...base,
      insights: [
        {
          type: 'trend',
          description: `Column "${dateCol}" is not a valid datetime column — trend analysis requires a date column`,
          confidence: 1.0,
        },
      ],
      summary: `Trend not computed: "${dateCol}" is not datetime`,
    };
  }

  // Identify numeric columns (excluding the date column itself)
  const numericCols = dataset.headers.filter(
    (h) => h !== dateCol && dataset.columnTypes[h] === 'numeric',
  );

  // Group rows by normalized day
  const groups = new Map<string, unknown[][]>();
  for (const row of dataset.rows) {
    const key = normalizeDateKey(row[dateIndex]);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  if (groups.size === 0) {
    return {
      ...base,
      insights: [
        {
          type: 'trend',
          description: `No valid dates found in "${dateCol}"`,
          confidence: 1.0,
        },
      ],
      summary: `Trend not computed: no valid dates in "${dateCol}"`,
    };
  }

  const sortedKeys = [...groups.keys()].sort();
  const series = sortedKeys.map((date) => {
    const rows = groups.get(date)!;
    const point: Record<string, unknown> = { date, count: rows.length };
    for (const col of numericCols) {
      const vals = rows
        .map((r) => r[dataset.headers.indexOf(col)])
        .filter((v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v)))
        .map(Number);
      if (vals.length > 0) {
        point[`${col}.mean`] = vals.reduce((a, b) => a + b, 0) / vals.length;
        point[`${col}.min`] = Math.min(...vals);
        point[`${col}.max`] = Math.max(...vals);
      }
    }
    return point;
  });

  // Trend direction insight from first vs last mean of the first numeric column
  const insights: DataInsight[] = [
    {
      type: 'trend',
      description: `${sortedKeys.length} time points analyzed from ${sortedKeys[0]} to ${sortedKeys[sortedKeys.length - 1]}`,
      confidence: 0.9,
      data: series,
    },
  ];
  const firstNumeric = numericCols[0];
  if (firstNumeric && series.length >= 2) {
    const firstVal = series[0][`${firstNumeric}.mean`] as number | undefined;
    const lastVal = series[series.length - 1][`${firstNumeric}.mean`] as number | undefined;
    if (firstVal !== undefined && lastVal !== undefined) {
      const pct = firstVal !== 0 ? ((lastVal - firstVal) / Math.abs(firstVal)) * 100 : 0;
      const direction = pct > 0 ? 'upward' : pct < 0 ? 'downward' : 'flat';
      insights.push({
        type: 'trend',
        description: `"${firstNumeric}" trend is ${direction} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% from first to last point)`,
        confidence: 0.75,
        data: { first: firstVal, last: lastVal, changePct: pct },
      });
    }
  }

  return {
    ...base,
    insights,
    summary: `Trend over ${sortedKeys.length} days — ${numericCols.length} numeric series`,
  };
}

// ─── Segment (grouped summary) ────────────────────────────────────────

function cmdSegment(dataset: Dataset, byCol: string): AnalysisResult {
  const base = cmdDescribe(dataset);
  const byIndex = dataset.headers.indexOf(byCol);

  if (byIndex === -1) {
    return {
      ...base,
      insights: [
        {
          type: 'statistical',
          description: `Column "${byCol}" not found — available: ${dataset.headers.join(', ')}`,
          confidence: 1.0,
        },
      ],
      summary: `Segment not computed: "${byCol}" not found`,
    };
  }

  const numericCols = dataset.headers.filter(
    (h) => h !== byCol && dataset.columnTypes[h] === 'numeric',
  );

  // Group rows by segment value
  const groups = new Map<string, unknown[][]>();
  for (const row of dataset.rows) {
    const key = String(row[byIndex] ?? '(empty)');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const segments = [...groups.entries()].map(([segment, rows]) => {
    const entry: Record<string, unknown> = { segment, count: rows.length };
    for (const col of numericCols) {
      const vals = rows
        .map((r) => r[dataset.headers.indexOf(col)])
        .filter((v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v)))
        .map(Number);
      if (vals.length > 0) {
        entry[`${col}.mean`] = vals.reduce((a, b) => a + b, 0) / vals.length;
        entry[`${col}.min`] = Math.min(...vals);
        entry[`${col}.max`] = Math.max(...vals);
      }
    }
    return entry;
  });

  // Dominant segment insight
  const insights: DataInsight[] = [
    {
      type: 'statistical',
      description: `${segments.length} segments by "${byCol}"`,
      confidence: 0.9,
      data: segments,
    },
  ];
  const sorted = [...segments].sort((a, b) => Number(b.count) - Number(a.count));
  if (sorted.length > 0) {
    insights.push({
      type: 'statistical',
      description: `Dominant segment: "${String(sorted[0].segment)}" (${sorted[0].count} rows, ${((Number(sorted[0].count) / dataset.rows.length) * 100).toFixed(1)}% of total)`,
      confidence: 0.9,
      data: sorted[0],
    });
  }

  return {
    ...base,
    insights,
    summary: `${segments.length} segments by "${byCol}" across ${dataset.rows.length} rows`,
  };
}

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(console.error);
}

export {
  cmdDescribe,
  cmdCorrelate,
  cmdTrend,
  cmdSegment,
  cmdAnomalies,
  parseCsv,
  parseJson,
  calculateStats,
  detectType,
  type AnalysisResult,
  type ColumnInfo,
  type ColumnStats,
  type Dataset,
};
