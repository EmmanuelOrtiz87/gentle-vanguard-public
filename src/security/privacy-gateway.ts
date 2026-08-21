#!/usr/bin/env node

/* eslint-disable security/detect-unsafe-regex */
/* These regex patterns are intentionally complex for injection detection - not user-input parsing */

import { runNpxTsxSync } from '../core/run-command.js';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

interface InjectionPattern {
  pattern: RegExp;
  category: string;
  severity: string;
}

interface InjectionResult {
  detected: boolean;
  category?: string;
  severity?: string;
  matched?: string;
}

interface BlockedResponse {
  status: string;
  category: string;
  severity: string;
  matched: string;
  message: string;
}

interface SuccessResponse {
  status: string;
  method: string;
  original: string;
  sanitized: string;
  target: string;
  injectionChecked: boolean;
}

const VALID_TARGETS = ['ai-api', 'mcp', 'log', 'error', 'prompt'] as const;
type Target = (typeof VALID_TARGETS)[number];

const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    pattern:
      /(?:\bignore\s+(?:all\s+)?(?:previous\s+)?(?:instructions|commands|directions|rules|prompts?|constraints?|guidelines?|orders?))\b/i,
    category: 'instruction-override',
    severity: 'CRITICAL',
  },
  {
    pattern:
      /(?:\b(?:repeat|output|print|show|display|reveal|leak|dump|copy)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions|rules|directions|commands|guidelines|initial\s+prompt|system\s+message))\b/i,
    category: 'prompt-leakage',
    severity: 'CRITICAL',
  },
  {
    pattern:
      /(?:\byou\s+(?:are\s+)?(?:now|must\s+act\s+as|will\s+pretend|have\s+to\s+roleplay|shall\s+behave))\b/i,
    category: 'role-takeover',
    severity: 'HIGH',
  },
  {
    pattern:
      /(?:DAN|do\s+anything\s+now|jailbreak|jail\s*broken|unrestricted\s+mode|god\s+mode|developer\s+mode|debug\s+mode|super\s+mode|free\s+mode|no\s+(?:limits|restrictions|filter|boundaries))\b/i,
    category: 'jailbreak',
    severity: 'CRITICAL',
  },
  {
    pattern:
      /(?:\$?(?:exec|run|eval|system|shell|cmd|powershell|bash|sh|zsh|os\.system|subprocess|child_process|execSync|spawn)\s*\()/i,
    category: 'code-execution',
    severity: 'CRITICAL',
  },
  {
    pattern:
      /(?:\b(?:new\s+)?system\s+prompt\s*[:=]|重置|新\s*的\s*提\s*示|system\s+message\s*[:=]|##?\s*system\s*(?:prompt|instructions))\b/i,
    category: 'prompt-override',
    severity: 'HIGH',
  },
  {
    pattern:
      /(?:base64\s*(?:decode|encode|64)|rot[0-9]+|hex\s*(?:decode|encode)|unicode\s*escape|reverse\s*(?:string|text))\s*(?:the\s+)?(?:following|above|below|this)\s*(?:text|message|prompt|string|instructions)/i,
    category: 'encoding-obfuscation',
    severity: 'HIGH',
  },
  {
    pattern:
      /(?:respond\s+(?:with|in\s+a\s+way\s+that\s+doesnt\s+reflect|without\s+(?:the\s+)?(?:usual|typical|standard|normal))|dont\s+(?:adhere|follow|abide|comply|stick)\s+to)/i,
    category: 'constraint-bypass',
    severity: 'HIGH',
  },
  {
    pattern:
      /(?:pretend|imagine|simulate|hypothetically)\s+(?:you\s+are|youve\s+been\s+replaced|you\s+have\s+no\s+(?:rules|restrictions|limits|boundaries|filters))/i,
    category: 'simulation-attack',
    severity: 'HIGH',
  },
  {
    pattern:
      /(?:forget|ignore|disregard|skip|omit|override|bypass|circumvent)\s+(?:all\s+)?(?:previous\s+)?(?:instructions|commands|rules|directions|prompts|constraints|guidelines|policies|safeguards|protocols)\b/i,
    category: 'instruction-override',
    severity: 'CRITICAL',
  },
];

function testInjectionAttempt(text: string): InjectionResult {
  for (const p of INJECTION_PATTERNS) {
    const match = text.match(p.pattern);
    if (match) {
      return { detected: true, category: p.category, severity: p.severity, matched: match[0] };
    }
  }
  return { detected: false };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fallbackSanitize(input: string): string {
  let result = input;
  const machineName = process.env.COMPUTERNAME ?? '';
  const userName = process.env.USERNAME ?? process.env.USER ?? '';
  const homePath = process.env.USERPROFILE ?? process.env.HOME ?? '';

  if (machineName) result = result.replace(new RegExp(escapeRegExp(machineName), 'g'), '<MACHINE>');
  if (userName) result = result.replace(new RegExp(escapeRegExp(userName), 'g'), '<USER>');
  if (homePath) result = result.replace(new RegExp(escapeRegExp(homePath), 'g'), '<HOME>');
  result = result.replace(/C:\\Users\\[^\\]+/g, '<HOME>');
  result = result.replace(/\/home\/[^/]+/g, '<HOME>');

  return result;
}

function parseArgs(): { text: string; target: Target; asJson: boolean } {
  const args = process.argv.slice(2);
  let text = '';
  let target: Target = 'prompt';
  let asJson = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--text':
        text = args[++i] ?? '';
        break;
      case '--target': {
        const raw = args[++i] ?? '';
        if (!(VALID_TARGETS as readonly string[]).includes(raw)) {
          console.error(`Invalid target: ${raw}. Valid values: ${VALID_TARGETS.join(', ')}`);
          process.exit(1);
        }
        target = raw as Target;
        break;
      }
      case '--as-json':
        asJson = true;
        break;
    }
  }

  if (!text) {
    console.error('--text is required');
    process.exit(1);
  }

  return { text, target, asJson };
}

function tryOrchestrator(text: string): string | null {
  const orchestratorTs = resolve('src/security-orchestrator.ts');
  if (!existsSync(orchestratorTs)) return null;

  try {
    const result = runNpxTsxSync(orchestratorTs, ['sanitize', text, 'prompt'], {
      stdio: 'pipe',
      timeout: 10000,
    });
    if (result.status !== 0 || !result.stdout?.trim()) return null;

    const parsed = JSON.parse(result.stdout.trim());
    if (parsed.status === 'BLOCKED') return null;
    return typeof parsed.sanitized === 'string' ? parsed.sanitized : result.stdout.trim();
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { text, target, asJson } = parseArgs();

  const injectionCheck = testInjectionAttempt(text);

  if (injectionCheck.detected) {
    const blocked: BlockedResponse = {
      status: 'BLOCKED',
      category: injectionCheck.category!,
      severity: injectionCheck.severity!,
      matched: injectionCheck.matched!,
      message: `Prompt security violation detected: ${injectionCheck.category} [severity: ${injectionCheck.severity}]`,
    };
    if (asJson) {
      console.log(JSON.stringify(blocked));
    } else {
      console.error(`[BLOCKED] ${blocked.message}`);
    }
    process.exit(1);
  }

  const orchestratorResult = tryOrchestrator(text);
  let sanitized: string;
  let method: string;

  if (orchestratorResult !== null) {
    sanitized = orchestratorResult;
    method = 'orchestrator';
  } else {
    sanitized = fallbackSanitize(text);
    method = 'fallback';
  }

  if (asJson) {
    const response: SuccessResponse = {
      status: 'OK',
      method,
      original: text,
      sanitized,
      target,
      injectionChecked: true,
    };
    console.log(JSON.stringify(response));
  } else {
    console.log(sanitized);
  }
}
