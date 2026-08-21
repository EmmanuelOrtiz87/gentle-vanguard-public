#!/usr/bin/env node
/**
 * Gentle AI Monitor — Monitors gentle-ai releases without installation.
 *
 * Fetches the latest release from GitHub to stay informed about updates,
 * learnings, and architectural improvements from the gentle-ai project.
 * Generates actionable suggestions for Gentle-Vanguard.
 *
 * Usage:
 *   npx tsx src/gentle-ai-monitor.ts [--analyze-release]
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

// ─── Config ───────────────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const AUDIT_DIR = join(ROOT, '.session', 'audit', 'logs');
const STATE_FILE = join(ROOT, '.runtime', 'gentle-ai-monitor-state.json');
const SUGGESTIONS_FILE = join(ROOT, '.session', 'gentle-ai-suggestions.md');

// ─── Types ───────────────────────────────────────────────────────────────────

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
}

interface Learning {
  category: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  action?: string;
}

interface Suggestion {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
  gentleAiFeature?: string;
  gentleVanguardAction?: string;
}

interface MonitorResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseDate: string;
  changelog: string;
  url: string;
  analyzed: boolean;
  learnings: Learning[];
  suggestions: Suggestion[];
  timestamp: string;
}

// ─── Logger ───────────────────────────────────────────────────────────────────

function log(
  message: string,
  level: 'INFO' | 'WARN' | 'SUCCESS' | 'LEARN' | 'SUGGEST' | 'ERROR' = 'INFO',
): void {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    SUCCESS: '\x1b[32m',
    LEARN: '\x1b[35m',
    SUGGEST: '\x1b[34m',
    ERROR: '\x1b[31m',
  };
  console.log(`${colors[level]}[${timestamp}] [GENTLE-AI-MONITOR] [${level}] ${message}\x1b[0m`);
}

// ─── GitHub API ───────────────────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  delay = 1000,
): Promise<Response | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response;
    } catch (err: any) {
      const isLastAttempt = i === retries - 1;
      const errorMsg = err?.message || String(err);

      // Handle UV_HANDLE_CLOSING and other fetch errors
      if (errorMsg.includes('UV_HANDLE_CLOSING') || errorMsg.includes('fetch failed')) {
        log(`Fetch attempt ${i + 1}/${retries} failed: ${errorMsg}`, 'WARN');
        if (!isLastAttempt) {
          log(`Waiting ${delay}ms before retry...`, 'INFO');
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }

      if (isLastAttempt) {
        log(`All ${retries} fetch attempts failed: ${errorMsg}`, 'ERROR');
        return null;
      }
    }
  }
  return null;
}

async function getLatestRelease(): Promise<GitHubRelease | null> {
  // Try GitHub API first (may fail with 403 without token)
  try {
    const response = await fetchWithRetry(
      'https://api.github.com/repos/Gentleman-Programming/gentle-ai/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Gentle-Vanguard/1.0',
        },
      },
    );

    if (!response) {
      log('GitHub API failed after retries, trying alternative method...', 'WARN');
    } else if (response.ok) {
      const release = (await response.json()) as GitHubRelease;
      log('Got release from GitHub API', 'INFO');
      return release;
    } else {
      log(`GitHub API returned ${response.status}, trying alternative method...`, 'WARN');
    }
  } catch (err) {
    log(
      `GitHub API failed: ${err instanceof Error ? err.message : String(err)}, trying alternative...`,
      'WARN',
    );
  }

  // Fallback: scrape the releases page for more details
  try {
    const response = await fetch('https://github.com/Gentleman-Programming/gentle-ai/releases', {
      headers: {
        'User-Agent': 'Gentle-Vanguard/1.0',
      },
    });

    if (!response.ok) {
      log(`Fallback also failed: ${response.status}`, 'ERROR');
      return null;
    }

    const html = await response.text();

    // Parse version from release page
    const versionMatch = html.match(/releases\/tag\/v?(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';

    // Try to get more info from the page
    const titleMatch = html.match(/Release (v?[\d.]+)/);
    const title = titleMatch ? titleMatch[0] : `Release ${version}`;

    // Try to extract release content - look for markdown content in the page
    // GitHub releases often have content in <article> or in markdown-body divs
    let content = '';

    // Try multiple patterns to extract release notes
    const patterns = [
      /<article[^>]*class="[^"]*markdown-body[^"]*"[^>]*>([\s\S]*?)<\/article>/i,
      /<div[^>]*class="markdown-body"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*class="release-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        content = match[1]
          .replace(/<[^>]+>/g, ' ') // Remove HTML tags
          .replace(/\s+/g, ' ') // Normalize whitespace
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .slice(0, 3000);
        break;
      }
    }

    // If we still don't have content, create a placeholder with what we know
    if (!content.trim()) {
      content = `gentle-ai version ${version} released. Check GitHub for full changelog.`;
    }

    return {
      tag_name: `v${version}`,
      name: title,
      body: content,
      published_at: new Date().toISOString(),
      html_url: 'https://github.com/Gentleman-Programming/gentle-ai/releases',
    };
  } catch (err) {
    log(`All methods failed: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
    return null;
  }
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

function analyzeChangelog(changelog: string): Learning[] {
  const learnings: Learning[] = [];

  // Define patterns to look for and what they mean for Gentle-Vanguard
  const patterns: {
    regex: RegExp;
    category: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
  }[] = [
    // Skills and patterns
    { regex: /skill/gi, category: 'Skills', description: 'New or updated skills', impact: 'high' },
    {
      regex: /pattern/gi,
      category: 'Patterns',
      description: 'New architectural patterns',
      impact: 'high',
    },
    {
      regex: /agent/gi,
      category: 'Agents',
      description: 'Agent-related changes',
      impact: 'medium',
    },

    // Security
    {
      regex: /security|vulnerability|CVE|auth|permission/gi,
      category: 'Security',
      description: 'Security improvements',
      impact: 'high',
    },

    // Performance
    {
      regex: /performance|optimize|fast|speed|efficiency/gi,
      category: 'Performance',
      description: 'Performance improvements',
      impact: 'medium',
    },

    // Review and quality
    {
      regex: /review|quality|audit|verify|validation/gi,
      category: 'Review',
      description: 'Review/quality changes',
      impact: 'high',
    },

    // Memory and persistence
    {
      regex: /memory|engram|persist|store/gi,
      category: 'Memory',
      description: 'Memory/persistence changes',
      impact: 'medium',
    },

    // Documentation
    {
      regex: /docs?|documentation|readme|guide/gi,
      category: 'Documentation',
      description: 'Documentation updates',
      impact: 'low',
    },

    // Breaking changes
    {
      regex: /breaking|migration|upgrade/gi,
      category: 'Migration',
      description: 'Breaking changes or migrations',
      impact: 'high',
    },

    // MCP and integrations
    {
      regex: /mcp|integration|connector|bridge/gi,
      category: 'Integrations',
      description: 'Integration changes',
      impact: 'medium',
    },

    // CLI and tools
    {
      regex: /cli|command|tool|script/gi,
      category: 'CLI',
      description: 'CLI or tool changes',
      impact: 'medium',
    },

    // Configuration
    {
      regex: /config|setting|option|flag/gi,
      category: 'Configuration',
      description: 'Configuration changes',
      impact: 'low',
    },
  ];

  for (const pattern of patterns) {
    if (pattern.regex.test(changelog)) {
      learnings.push({
        category: pattern.category,
        description: pattern.description,
        impact: pattern.impact,
      });
    }
  }

  return learnings;
}

function generateSuggestions(learnings: Learning[], version: string): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const learning of learnings) {
    switch (learning.category) {
      case 'Skills':
        suggestions.push({
          title: 'Review new skill patterns',
          description: `gentle-ai v${version} has new or updated skills. Review the release to identify skills we should add to Gentle-Vanguard.`,
          priority: learning.impact,
          category: 'Skills',
          gentleAiFeature: 'New/updated skills',
          gentleVanguardAction: 'Analyze and port relevant skills to .opencode/skills/',
        });
        break;

      case 'Patterns':
        suggestions.push({
          title: 'Evaluate new architectural patterns',
          description: `gentle-ai v${version} introduces new patterns. Consider adopting them in Gentle-Vanguard.`,
          priority: learning.impact,
          category: 'Architecture',
          gentleAiFeature: 'New patterns',
          gentleVanguardAction: 'Document in docs/reference/ and implement if applicable',
        });
        break;

      case 'Security':
        suggestions.push({
          title: 'Apply security improvements',
          description: `gentle-ai v${version} includes security updates. Review and apply to Gentle-Vanguard.`,
          priority: 'high',
          category: 'Security',
          gentleAiFeature: 'Security improvements',
          gentleVanguardAction: 'Audit current security and apply fixes',
        });
        break;

      case 'Review':
        suggestions.push({
          title: 'Enhance review process',
          description: `gentle-ai v${version} has review-related changes. Check if we should align our review process.`,
          priority: learning.impact,
          category: 'Review',
          gentleAiFeature: 'Review changes',
          gentleVanguardAction: 'Update .opencode/skills/code-review-and-quality/',
        });
        break;

      case 'Memory':
        suggestions.push({
          title: 'Update memory/persistence',
          description: `gentle-ai v${version} has memory changes. Ensure engram integration is current.`,
          priority: learning.impact,
          category: 'Memory',
          gentleAiFeature: 'Memory changes',
          gentleVanguardAction: 'Run engram-auto-update and verify integration',
        });
        break;

      case 'Integrations':
        suggestions.push({
          title: 'Review integration changes',
          description: `gentle-ai v${version} has integration updates. Check MCP and connector compatibility.`,
          priority: learning.impact,
          category: 'Integrations',
          gentleAiFeature: 'Integration changes',
          gentleVanguardAction: 'Verify MCP servers and cloud connectors',
        });
        break;

      case 'CLI':
        suggestions.push({
          title: 'Update CLI tools',
          description: `gentle-ai v${version} has CLI changes. Consider if we need new scripts.`,
          priority: learning.impact,
          category: 'CLI',
          gentleAiFeature: 'CLI changes',
          gentleVanguardAction: 'Review and add scripts if needed',
        });
        break;
    }
  }

  return suggestions;
}

function formatSuggestionsAsMarkdown(suggestions: Suggestion[], version: string): string {
  let md = `# Gentle-AI v${version} - Suggestions for Gentle-Vanguard\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;

  if (suggestions.length === 0) {
    md += 'No specific suggestions for this release.\n';
    return md;
  }

  // Group by priority
  const high = suggestions.filter((s) => s.priority === 'high');
  const medium = suggestions.filter((s) => s.priority === 'medium');
  const low = suggestions.filter((s) => s.priority === 'low');

  if (high.length > 0) {
    md += `## 🔴 High Priority\n\n`;
    for (const s of high) {
      md += `### ${s.title}\n`;
      md += `${s.description}\n\n`;
      md += `- **Category:** ${s.category}\n`;
      if (s.gentleAiFeature) md += `- **Gentle-AI Feature:** ${s.gentleAiFeature}\n`;
      if (s.gentleVanguardAction) md += `- **Action:** ${s.gentleVanguardAction}\n`;
      md += '\n';
    }
  }

  if (medium.length > 0) {
    md += `## 🟡 Medium Priority\n\n`;
    for (const s of medium) {
      md += `### ${s.title}\n`;
      md += `${s.description}\n\n`;
      md += `- **Category:** ${s.category}\n`;
      if (s.gentleAiFeature) md += `- **Gentle-AI Feature:** ${s.gentleAiFeature}\n`;
      if (s.gentleVanguardAction) md += `- **Action:** ${s.gentleVanguardAction}\n`;
      md += '\n';
    }
  }

  if (low.length > 0) {
    md += `## 🟢 Low Priority\n\n`;
    for (const s of low) {
      md += `### ${s.title}\n`;
      md += `${s.description}\n\n`;
      md += `- **Category:** ${s.category}\n`;
      if (s.gentleAiFeature) md += `- **Gentle-AI Feature:** ${s.gentleAiFeature}\n`;
      if (s.gentleVanguardAction) md += `- **Action:** ${s.gentleVanguardAction}\n`;
      md += '\n';
    }
  }

  return md;
}

// ─── State Management ─────────────────────────────────────────────────────────

function loadState(): { lastCheck: string; lastVersion: string } | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveState(state: { lastCheck: string; lastVersion: string }): void {
  mkdirSync(join(ROOT, '.runtime'), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function logAudit(result: MonitorResult): void {
  const dateStr = new Date().toISOString().slice(0, 10);
  const auditFile = join(AUDIT_DIR, `gentle-ai-monitor-${dateStr}.jsonl`);

  mkdirSync(AUDIT_DIR, { recursive: true });
  const entry = JSON.stringify({
    ...result,
    loggedAt: new Date().toISOString(),
  });

  const existing = existsSync(auditFile) ? readFileSync(auditFile, 'utf-8') : '';
  writeFileSync(auditFile, existing + entry + '\n', 'utf-8');
}

// ─── Main Logic ───────────────────────────────────────────────────────────────

async function runMonitor(analyzeRelease = false): Promise<MonitorResult> {
  const result: MonitorResult = {
    currentVersion: 'not-installed',
    latestVersion: 'unknown',
    updateAvailable: false,
    releaseDate: '',
    changelog: '',
    url: '',
    analyzed: analyzeRelease,
    learnings: [],
    suggestions: [],
    timestamp: new Date().toISOString(),
  };

  // Get latest release from GitHub
  const release = await getLatestRelease();

  if (!release) {
    log('Failed to fetch release information', 'ERROR');
    return result;
  }

  // Parse version from tag
  const latestVersion = release.tag_name.replace(/^v/, '');
  result.latestVersion = latestVersion;
  result.releaseDate = release.published_at.slice(0, 10);
  result.changelog = release.body;
  result.url = release.html_url;

  // Check if we have a previous version to compare
  const state = loadState();
  if (state && state.lastVersion) {
    result.currentVersion = state.lastVersion;
    result.updateAvailable = state.lastVersion !== latestVersion;
  }

  // Log version info
  log(`Latest gentle-ai release: ${latestVersion}`, 'INFO');
  log(`Release date: ${result.releaseDate}`, 'INFO');
  log(`URL: ${result.url}`, 'INFO');

  if (result.updateAvailable) {
    log(`New version available: ${state?.lastVersion} -> ${latestVersion}`, 'WARN');
  } else if (state) {
    log(`Already on latest version (${latestVersion})`, 'SUCCESS');
  }

  // Analyze if requested
  if (analyzeRelease && release.body) {
    result.learnings = analyzeChangelog(release.body);

    if (result.learnings.length > 0) {
      log('Learnings identified:', 'LEARN');
      for (const learning of result.learnings) {
        log(
          `  - [${learning.impact.toUpperCase()}] ${learning.category}: ${learning.description}`,
          'LEARN',
        );
      }

      // Generate suggestions
      result.suggestions = generateSuggestions(result.learnings, latestVersion);

      if (result.suggestions.length > 0) {
        log('Suggestions generated:', 'SUGGEST');
        for (const suggestion of result.suggestions) {
          log(`  - [${suggestion.priority.toUpperCase()}] ${suggestion.title}`, 'SUGGEST');
        }

        // Save suggestions to file
        const suggestionsMd = formatSuggestionsAsMarkdown(result.suggestions, latestVersion);
        writeFileSync(SUGGESTIONS_FILE, suggestionsMd, 'utf-8');
        log(`Suggestions saved to: ${SUGGESTIONS_FILE}`, 'INFO');
      }
    } else {
      log('No specific learnings identified', 'INFO');
    }
  }

  // Save state
  saveState({ lastCheck: new Date().toISOString(), lastVersion: latestVersion });

  // Log to audit
  logAudit(result);

  return result;
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void (async () => {
    const args = process.argv.slice(2);
    const analyzeRelease = args.includes('--analyze-release');

    try {
      const result = await runMonitor(analyzeRelease);
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    } catch (err) {
      log(`Fatal error: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
      process.exit(1);
    }
  })();
}

export type { MonitorResult, Learning, Suggestion };
