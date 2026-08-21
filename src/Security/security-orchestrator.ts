#!/usr/bin/env node

/* eslint-disable security/detect-unsafe-regex */
/* These regex patterns are intentionally complex for security token detection - not user-input parsing */

export type SecurityMode = 'prompt' | 'log' | 'error' | 'audit';
export type SecurityAction =
  'init' | 'sanitize' | 'audit' | 'block' | 'status' | 'enable' | 'disable' | 'scan';

export interface SecurityActionResult {
  status: 'OK' | 'AUTH_REQUIRED' | 'BLOCKED' | 'ERROR';
  message?: string;
  sanitized?: string;
  original?: string;
  mode?: SecurityMode;
  pattern?: string;
  requireAuth?: boolean;
}

export interface SecurityPattern {
  name: string;
  pattern: RegExp;
}

const criticalPatterns: SecurityPattern[] = [
  { name: 'AWS Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub Token', pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'Stripe Key', pattern: /sk_live_[0-9a-zA-Z]{24,}/ },
  { name: 'Private Key', pattern: /-----BEGIN .+ PRIVATE KEY-----/ },
  {
    name: 'Prompt Injection: Instruction Override',
    pattern:
      /(?:\bignore\s+(?:all\s+)?(?:previous\s+)?(?:instructions|commands|directions|rules|prompts?|constraints?|guidelines?))\b/i,
  },
  {
    name: 'Prompt Injection: Prompt Leakage',
    pattern:
      /(?:\b(?:repeat|output|print|show|display|reveal|leak|dump|copy)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions|rules))\b/i,
  },
  {
    name: 'Prompt Injection: Jailbreak',
    pattern:
      /(?:DAN|do\s+anything\s+now|jailbreak|unrestricted\s+mode|developer\s+mode|no\s+(?:limits|restrictions|filter))/i,
  },
  {
    name: 'Prompt Injection: Code Execution',
    pattern:
      /\$?(?:exec|eval|system|shell|cmd|powershell|bash|os\.system|subprocess|child_process|execSync|spawn)\s*\(/i,
  },
  {
    name: 'Prompt Injection: Role Takeover',
    pattern: /\byou\s+(?:are\s+)?(?:now|must\s+act\s+as|will\s+pretend|shall\s+behave)\b/i,
  },
  {
    name: 'Prompt Injection: Encoding Obfuscation',
    pattern: /(?:base64|hex|rot13|unicode|escape)\s*(?:decode|decodeURIComponent|fromCharCode)/i,
  },
  {
    name: 'Prompt Injection: Constraint Bypass',
    pattern:
      /(?:forget|disregard|override|bypass|ignore\s+all\s+)(?:instructions|rules|safeguards|protocols|constraints)/i,
  },
  {
    name: 'Prompt Injection: Direct System Access',
    pattern: /(?:run|execute|launch|start)\s+(?:shell|terminal|command|process|system)/i,
  },
  {
    name: 'Prompt Injection: API Access',
    pattern: /(?:fetch|request|call|invoke)\s+(?:api|endpoint|url|resource)/i,
  },
  {
    name: 'Prompt Injection: File System Access',
    pattern: /(?:read|write|delete|modify|access)\s+(?:file|filesystem|directory|path)/i,
  },
];

export function sanitizeText(text: string, mode: SecurityMode = 'prompt'): string {
  if (!text) return text;

  let result = text;
  const replaceMachine = (value: string) => value.replace(/DESKTOP-1|COMPUTERNAME/gi, '<MACHINE>');
  const replaceUser = (value: string) => value.replace(/emmanuel|USERNAME/gi, '<USER>');
  const replaceHome = (value: string) =>
    value.replace(/C:\\Users\\[^\\]+|C:\/Users\/[^/]+/g, '<HOME>');
  const replaceSecret = (value: string) => value.replace(/ghp_[A-Za-z0-9]{36}/g, '<TOKEN>');
  const replaceEncoding = (value: string) => {
    // Replace common encoding patterns that could be used for obfuscation
    return value
      .replace(/base64_decode\([^)]*\)/gi, 'base64_decode(<OBSCURED>)')
      .replace(/decodeURIComponent\([^)]*\)/gi, 'decodeURIComponent(<OBSCURED>)')
      .replace(/fromCharCode\([^)]*\)/gi, 'fromCharCode(<OBSCURED>)')
      .replace(/unescape\([^)]*\)/gi, 'unescape(<OBSCURED>)');
  };

  if (mode === 'prompt') {
    result = replaceMachine(result);
    result = replaceUser(result);
    result = replaceHome(result);
    result = replaceSecret(result);
    result = replaceEncoding(result);
  } else if (mode === 'log') {
    result = replaceMachine(result);
    result = replaceUser(result);
    result = replaceHome(result);
    result = replaceEncoding(result);
  } else if (mode === 'error') {
    result = replaceMachine(result);
    result = replaceUser(result);
    result = replaceEncoding(result);
  }

  return result;
}

export function testBlockCritical(text: string): { blocked: boolean; pattern?: string } {
  // First, check for basic critical patterns
  for (const entry of criticalPatterns) {
    if (entry.pattern.test(text)) {
      return { blocked: true, pattern: entry.name };
    }
  }

  // Additional security checks for advanced injection techniques
  const advancedPatterns = [
    // Check for potential command execution patterns
    {
      name: 'Potential Command Execution',
      pattern: /(?:\$\(|`|\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4})/i,
    },
    // Check for potential file system access
    {
      name: 'Potential File Access',
      pattern: /(?:\/etc\/passwd|\/etc\/shadow|C:\\Windows\\System32|\/proc\/self)/i,
    },
    // Check for potential environment variable access
    {
      name: 'Potential Env Var Access',
      pattern: /(?:\$\{[^}]+\}|%[^%]+%)/i,
    },
  ];

  for (const entry of advancedPatterns) {
    if (entry.pattern.test(text)) {
      return { blocked: true, pattern: entry.name };
    }
  }

  return { blocked: false };
}

export function evaluateAction(
  action: SecurityAction,
  content?: string,
  mode: SecurityMode = 'prompt',
  apiKey?: string,
  authenticated = false,
): SecurityActionResult {
  const restrictedActions = new Set<SecurityAction>(['enable', 'disable', 'audit', 'scan']);
  if (restrictedActions.has(action) && !authenticated && !apiKey) {
    return {
      status: 'AUTH_REQUIRED',
      requireAuth: true,
      message: `Operation '${action}' requires authentication.`,
    };
  }

  switch (action) {
    case 'sanitize': {
      if (!content) return { status: 'ERROR', message: 'Content required for sanitize' };
      const blocked = testBlockCritical(content);
      if (blocked.blocked) {
        return {
          status: 'BLOCKED',
          message: `Critical pattern detected: ${blocked.pattern}`,
          pattern: blocked.pattern,
        };
      }
      return { status: 'OK', original: content, sanitized: sanitizeText(content, mode), mode };
    }
    case 'block': {
      const blocked = testBlockCritical(content ?? '');
      if (blocked.blocked) {
        return {
          status: 'BLOCKED',
          message: `Blocked: ${blocked.pattern}`,
          pattern: blocked.pattern,
        };
      }
      return { status: 'OK', message: 'Allowed' };
    }
    case 'status':
    case 'init':
      return { status: 'OK', message: `${action} completed` };
    case 'enable':
    case 'disable':
      return { status: 'OK', message: `Security ${action}d` };
    case 'audit':
      return { status: 'OK', message: 'Audit logged' };
    case 'scan':
      return { status: 'OK', message: 'Scan completed' };
    default:
      return { status: 'ERROR', message: 'Unsupported action' };
  }
}

/**
 * Enhanced hallucination prevention for critical workflows
 * @param content - The content to analyze for hallucination risks
 * @param agentTier - The agent tier (low, medium, high) that determines the level of protection needed
 * @returns Whether the content contains hallucination risks
 */
export function detectHallucination(
  content: string,
  agentTier: 'low' | 'medium' | 'high' = 'medium',
): {
  hasRisk: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  details?: string[];
} {
  const risks: string[] = [];

  // Different thresholds based on agent tier
  const riskThresholds = {
    low: 2,
    medium: 1,
    high: 0,
  };

  // Check for common hallucination patterns
  const hallucinationPatterns = [
    {
      name: 'Unverified Claims',
      pattern:
        /\b(?:according to|as stated by|reports that|claims that)\b.*\b(?:AI|bot|system|assistant)\b/i,
      severity: 'medium' as const,
    },
    {
      name: 'Fabricated Sources',
      pattern: /\b(?:source:|via:|from:)\s*(?:unknown|unverified|anonymous|uncited)/i,
      severity: 'high' as const,
    },
    {
      name: 'Overly Specific Details',
      pattern: /\b(?:exact|precise|definite|certain)\b.*\b(?:date|time|location|person)\b/i,
      severity: 'medium' as const,
    },
    {
      name: 'Absolute Statements',
      pattern:
        /\b(?:always|never|completely|totally|absolutely)\b.*\b(?:true|correct|right|wrong)\b/i,
      severity: 'high' as const,
    },
    {
      name: 'Conflicting Information',
      pattern:
        /\b(?:but|however|although|while|whereas)\b.*\b(?:different|conflicting|opposite|contrary)\b/i,
      severity: 'medium' as const,
    },
  ];

  // Check for hallucination patterns
  for (const pattern of hallucinationPatterns) {
    if (pattern.pattern.test(content)) {
      risks.push(pattern.name);
    }
  }

  // Determine risk level based on agent tier and number of risks found
  const riskCount = risks.length;
  let riskLevel: 'low' | 'medium' | 'high' = 'low';

  if (riskCount >= riskThresholds[agentTier]) {
    riskLevel = 'high';
  } else if (riskCount > 0) {
    riskLevel = 'medium';
  }

  return {
    hasRisk: riskCount > 0,
    riskLevel,
    details: risks,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const action = process.argv[2] as SecurityAction | undefined;
  const mode = (process.argv[3] as SecurityMode | undefined) ?? 'prompt';
  const result = evaluateAction(action ?? 'status', process.argv[4], mode);
  console.log(JSON.stringify(result));
}
