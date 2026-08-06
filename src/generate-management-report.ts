#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { runSync } from './core/run-command.js';

interface CliArgs {
  outputDir: string;
  forceNewMonth: boolean;
  onDemand: boolean;
}

interface TelemetryData {
  TokensIn?: number;
  TokensOut?: number;
  [key: string]: unknown;
}

interface SessionData {
  startTime?: string;
  endTime?: string;
  project?: string;
  [key: string]: unknown;
}

interface EngramObservation {
  session_id?: string | { toString(): string };
  session?: string | { toString(): string };
  title?: string | { toString(): string };
  type?: string;
  [key: string]: unknown;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { outputDir: 'reports', forceNewMonth: false, onDemand: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output-dir' || args[i] === '-OutputDir') {
      result.outputDir = args[++i] || 'reports';
    } else if (args[i] === '--force-new-month' || args[i] === '-ForceNewMonth') {
      result.forceNewMonth = true;
    } else if (args[i] === '--on-demand' || args[i] === '-OnDemand') {
      result.onDemand = true;
    }
  }
  return result;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function currentMonthYear(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function main(): void {
  const { outputDir, forceNewMonth, onDemand } = parseArgs();

  const scriptPath = pathToFileURL(process.argv[1]).pathname;
  let workspaceRoot = path.resolve(scriptPath);
  for (let i = 0; i < 3; i++) {
    workspaceRoot = path.dirname(workspaceRoot);
  }
  workspaceRoot = path.resolve(workspaceRoot);

  const reportsPath = path.join(workspaceRoot, outputDir);
  if (!fs.existsSync(reportsPath)) {
    fs.mkdirSync(reportsPath, { recursive: true });
  }

  const now = new Date();
  const currentMonth = currentMonthYear();
  const reportFile = path.join(reportsPath, `MANAGEMENT-REPORT-${currentMonth}.csv`);

  let needNewFile = false;
  if (forceNewMonth || !fs.existsSync(reportFile)) {
    needNewFile = true;
  } else if (!onDemand) {
    try {
      const firstLine = fs.readFileSync(reportFile, 'utf-8').split('\n')[0];
      const parts = firstLine.split(',');
      if (parts.length > 1) {
        const fileMonth = parts[1].replace(/"/g, '').replace(/-.*$/, '');
        if (fileMonth !== currentMonth) {
          console.log(`[WARN] Month changed! Please export: ${reportFile}`);
          console.log('   Then re-run with --force-new-month to start new file');
          process.exit(0);
        }
      }
    } catch { /* ignore */ }
  }

  if (needNewFile) {
    const headers = 'SessionID,Date,User,Project,TokensIn,TokensOut,SkillsUsed,SystemsTriggered,ActionsPerformed,Outcome,IssuesFound,Duration(min),Cost(USD),Notes';
    fs.writeFileSync(reportFile, headers + '\n', 'utf-8');
    console.log(`[OK] Created new report: ${reportFile}`);
  }

  if (!onDemand) {
    const daysUntilEnd = daysInMonth(now.getFullYear(), now.getMonth() + 1) - now.getDate();
    if (daysUntilEnd <= 3 && daysUntilEnd >= 0) {
      console.log(`[WARN] REMINDER: Only ${daysUntilEnd} day(s) left! Export: ${reportFile}`);
    }
  }

  console.log('[DATA] Collecting session data...');

  const sessionDir = path.join(workspaceRoot, '.session');
  const telemetryDir = path.join(workspaceRoot, '.telemetry');

  let engramObservations: EngramObservation[] = [];
  try {
    const engramExe = path.join(workspaceRoot, 'gentle-vanguard', 'tools', 'engram.exe');
    if (fs.existsSync(engramExe)) {
      console.log('   [EXPORT] Exporting Engram data...');
      const exportFile = path.join(workspaceRoot, 'engram-export.json');
      runSync(engramExe, ['export', exportFile], { cwd: workspaceRoot, timeout: 30000 });

      if (fs.existsSync(exportFile)) {
        try {
          const raw = fs.readFileSync(exportFile, 'utf-8');
          if (raw.trim().startsWith('{')) {
            const engramData = JSON.parse(raw);
            if (engramData.observations && engramData.observations.length > 0) {
              engramObservations = engramData.observations;
              console.log(`   [OK] Engram data loaded: ${engramObservations.length} observations`);
            } else {
              console.log('   [WARN] Engram export has no observations');
            }
          } else {
            console.log('   [WARN] Engram export is not valid JSON');
          }
        } catch (e) {
          console.log(`   [WARN] Engram parse error: ${e}`);
        }
      } else {
        console.log('   [WARN] Engram export file not created');
      }
    } else {
      console.log('   [WARN] engram.exe not found');
    }
  } catch (e) {
    console.log(`   [WARN] Engram error: ${e}`);
  }

  if (fs.existsSync(sessionDir)) {
    let sessionFiles: string[];
    try {
      sessionFiles = fs.readdirSync(sessionDir)
        .filter(f => f.startsWith('session-') && f.endsWith('.json'))
        .map(f => path.join(sessionDir, f))
        .filter(fp => {
          try {
            const stat = fs.statSync(fp);
            const mtime = stat.mtime;
            return mtime.getMonth() === now.getMonth() && mtime.getFullYear() === now.getFullYear();
          } catch { return false; }
        });
    } catch {
      sessionFiles = [];
    }

    const username = process.env.USERNAME || process.env.USER || 'unknown';

    for (const sessionFile of sessionFiles) {
      try {
        const raw = fs.readFileSync(sessionFile, 'utf-8');
        const sessionData = JSON.parse(raw) as SessionData;
        const sessionId = path.basename(sessionFile, '.json');

        let tokensIn = 0;
        let tokensOut = 0;
        let skillsUsed = '';
        let actionsPerformed = '';
        const outcome = 'COMPLETE';
        const issuesFound = 0;
        let duration = 0;
        let cost = 0.0;

        try {
          if (fs.existsSync(telemetryDir)) {
            const telemetryFiles = fs.readdirSync(telemetryDir)
              .filter(f => f.includes(sessionId) && f.endsWith('.json'));
            if (telemetryFiles.length > 0) {
              const telemetryRaw = fs.readFileSync(path.join(telemetryDir, telemetryFiles[0]), 'utf-8');
              const telemetryData = JSON.parse(telemetryRaw) as TelemetryData;
              if (telemetryData.TokensIn !== undefined) tokensIn = telemetryData.TokensIn;
              if (telemetryData.TokensOut !== undefined) tokensOut = telemetryData.TokensOut;
            }
          }
        } catch { /* ignore */ }

        const startTime = sessionData.startTime ? new Date(sessionData.startTime) : new Date();
        const endTime = sessionData.endTime ? new Date(sessionData.endTime) : new Date();
        duration = Math.round((endTime.getTime() - startTime.getTime()) / 60000 * 100) / 100;

        if (engramObservations.length > 0) {
          const sessionObs = engramObservations.filter(obs => {
            const obsSessionId = obs.session_id ? String(obs.session_id) : '';
            const obsSession = obs.session ? String(obs.session) : '';
            const obsTitle = obs.title ? String(obs.title) : '';
            return obsSessionId.includes(sessionId) || obsSession.includes(sessionId) || obsTitle.includes(sessionId);
          });

          if (sessionObs.length > 0) {
            console.log(`   [OK] Found ${sessionObs.length} observations for ${sessionId}`);
            const skillTitles = [...new Set(
              sessionObs
                .filter(obs => obs.type === 'skill' || (obs.title && /skill|Skill/.test(String(obs.title))))
                .map(obs => String(obs.title))
                .filter(Boolean)
            )];
            skillsUsed = skillTitles.length > 0 ? skillTitles.join(';') : '';

            const actionTitles = [...new Set(
              sessionObs
                .filter(obs =>
                  obs.type === 'architecture' || obs.type === 'manual' ||
                  (obs.title && /Fixed|Created|Updated|Implemented|Validated/.test(String(obs.title)))
                )
                .map(obs => String(obs.title))
                .filter(Boolean)
            )];
            actionsPerformed = actionTitles.length > 0 ? actionTitles.join(';') : '';
          }
        }

        cost = Math.round((tokensIn + tokensOut) * 0.0001 * 10000) / 10000;

        const row = [
          escapeCsv(sessionId),
          escapeCsv(formatDate(startTime)),
          escapeCsv(username),
          escapeCsv(sessionData.project || ''),
          String(tokensIn),
          String(tokensOut),
          escapeCsv(skillsUsed || 'auto-reporting'),
          escapeCsv('auto-backup,auto-norm-enforcer,auto-doc-drift-detector'),
          escapeCsv(actionsPerformed || 'Session tracking'),
          escapeCsv(outcome),
          String(issuesFound),
          String(duration),
          String(cost),
          escapeCsv('Auto-collected from session + Engram'),
        ].join(',');

        fs.appendFileSync(reportFile, row + '\n', 'utf-8');
        console.log(`   [OK] Added: ${sessionId}`);
      } catch (e) {
        console.log(`   [WARN] Error processing ${path.basename(sessionFile)}: ${e}`);
      }
    }
  }

  console.log(`[OK] Report updated: ${reportFile}`);
  if (fs.existsSync(reportFile)) {
    const rowCount = fs.readFileSync(reportFile, 'utf-8').trim().split('\n').length - 1;
    console.log(`   Total rows: ${rowCount}`);
  }

  console.log('\n[PREVIEW] First 3 rows:');
  if (fs.existsSync(reportFile)) {
    const lines = fs.readFileSync(reportFile, 'utf-8').split('\n').slice(0, 4);
    for (const line of lines) {
      console.log(line);
    }
  }
}

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

main();
