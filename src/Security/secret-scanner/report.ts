import { loadConfig } from './config.js';
import type { SecretCategory, RiskLevel, SecretMatch } from './scanner.js';

export interface SecretReport {
  scannedAt: string;
  total: number;
  byCategory: Record<string, number>;
  byRisk: Record<RiskLevel, number>;
  matches: SecretMatch[];
  redacted: boolean;
}

export interface ReportOptions {
  redact?: boolean;
  riskLevels?: Partial<Record<SecretCategory, RiskLevel>>;
}

// ─── Report ───────────────────────────────────────────────────────────────────

export function buildReport(matches: SecretMatch[], options: ReportOptions = {}): SecretReport {
  const cfg = loadConfig();
  const redact = options.redact ?? cfg.redactByDefault;
  const riskLevels = options.riskLevels ?? cfg.riskLevels;

  const byCategory: Record<string, number> = {};
  const byRisk: Record<RiskLevel, number> = { high: 0, medium: 0, low: 0 };

  const normalized: SecretMatch[] = matches.map((m) => {
    const category = m.pattern.category;
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    const risk = riskLevels[category] ?? m.pattern.risk;
    byRisk[risk] = byRisk[risk] + 1;
    return { ...m, pattern: { ...m.pattern, risk } };
  });

  return {
    scannedAt: new Date().toISOString(),
    total: normalized.length,
    byCategory,
    byRisk,
    matches: normalized,
    redacted: redact,
  };
}
