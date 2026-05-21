import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getProjectContext } from './context.js';

import { getScheduler } from './scheduler.js';
import { parseNLToCron, listSupportedPatterns } from './nl-time-parser.js';
import { getPluginTools, getPluginExecutor, reloadPlugins } from './plugin-loader.js';
import { submitFeedback as fbSubmit, getFeedbackStats, getFeedbackTrend } from '../feedback/feedback-store.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MAX_OUTPUT = 10000;
const SCHEDULE_FILE = path.join(ROOT, '.session', 'gateway', 'schedules.json');

function truncate(text) {
  if (!text || text.length <= MAX_OUTPUT) return text || '';
  return text.slice(0, MAX_OUTPUT) + `\n... [truncated ${text.length - MAX_OUTPUT} more chars]`;
}

function safeExec(cmd, cwd = ROOT) {
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
    return { success: true, output: truncate(out) };
  } catch (err) {
    return { success: false, output: truncate(err.stdout + '\n' + err.stderr), error: err.message };
  }
}

const noParams = { type: 'object', properties: {}, required: [] };

function buildToolDefs() {
  const staticDefs = [
    { name: 'execute_command', description: 'Execute a PowerShell or shell command in the project root.',
    parameters: { type: 'object', properties: {
      command: { type: 'string', description: 'Command to execute' },
      workdir: { type: 'string', description: 'Working directory relative to project root (default: ".")' },
      timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
    }, required: ['command'] } },
  { name: 'read_file', description: 'Read the contents of a file.',
    parameters: { type: 'object', properties: {
      path: { type: 'string', description: 'File path relative to project root' },
      limit: { type: 'number', description: 'Max lines to read (default: 200)' },
    }, required: ['path'] } },
  { name: 'write_file', description: 'Write content to a file. Creates directories if needed. WARNING: Overwrites existing files.',
    parameters: { type: 'object', properties: {
      path: { type: 'string', description: 'File path relative to project root' },
      content: { type: 'string', description: 'Content to write' },
    }, required: ['path', 'content'] } },
  { name: 'search_files', description: 'Search file contents using regex.',
    parameters: { type: 'object', properties: {
      pattern: { type: 'string', description: 'Regex pattern (e.g. "function\\\\s+\\\\w+")' },
      include: { type: 'string', description: 'File glob filter (e.g. "*.js")' },
      path: { type: 'string', description: 'Subdirectory to search (default: ".")' },
    }, required: ['pattern'] } },
  { name: 'list_directory', description: 'List files and directories at a given path.',
    parameters: { type: 'object', properties: {
      path: { type: 'string', description: 'Directory relative to project root (default: ".")' },
      depth: { type: 'number', description: 'Max depth (default: 1, max: 3)' },
    }, required: [] } },
  { name: 'git_command', description: 'Run a git command (status, diff, log, add, commit, branch).',
    parameters: { type: 'object', properties: {
      args: { type: 'string', description: 'Git arguments (e.g. "status", "diff", "log --oneline -5")' },
    }, required: ['args'] } },
  { name: 'send_message', description: 'Send a message back to the user via their original platform. Use this for final responses.',
    parameters: { type: 'object', properties: {
      text: { type: 'string', description: 'Message text (Markdown supported)' },
    }, required: ['text'] } },
  { name: 'gateway_status', description: 'Returns current gateway state: running, platforms, inbox/outbox counts, schedules.',
    parameters: noParams },
  { name: 'process_inbox', description: 'Process pending messages in the gateway inbox. Returns count and details.',
    parameters: { type: 'object', properties: {
      markRead: { type: 'boolean', description: 'Mark as processed (default: true)' },
    }, required: [] } },
  { name: 'list_schedules', description: 'List active cron tasks (id, description, cron, platform, enabled).',
    parameters: noParams },
  { name: 'load_skill', description: 'Load a skill from skills/<name>/SKILL.md.',
    parameters: { type: 'object', properties: {
      name: { type: 'string', description: 'Skill directory name (e.g. "codegraph-skill")' },
    }, required: ['name'] } },
  { name: 'session_info', description: 'Returns current session context: branch, commit, engram, gateway, platforms.',
    parameters: noParams },
  { name: 'schedule_create', description: 'Creates a scheduled task from NL or cron time expression.',
    parameters: { type: 'object', properties: {
      description: { type: 'string', description: 'Human-readable description' },
      timeExpression: { type: 'string', description: 'NL time like "every 5 min", "every day at 9 AM", or 5-field cron' },
      action: { type: 'string', enum: ['report', 'git-status', 'command'], description: 'Action to execute' },
      platform: { type: 'string', description: 'Target platform (whatsapp, telegram, discord)' },
      target: { type: 'string', description: 'Optional recipient override' },
    }, required: ['description', 'timeExpression', 'action', 'platform'] } },
  { name: 'schedule_list', description: 'Lists all scheduled tasks with IDs, descriptions, cron, and status.',
    parameters: noParams },
  { name: 'schedule_remove', description: 'Removes a scheduled task by ID.',
    parameters: { type: 'object', properties: {
      taskId: { type: 'string', description: 'Task ID to remove' },
    }, required: ['taskId'] } },
  { name: 'schedule_parse_time', description: 'Tests an NL time expression and returns cron equivalent. For debugging.',
    parameters: { type: 'object', properties: {
      text: { type: 'string', description: 'NL time expression to parse' },
    }, required: ['text'] } },
  { name: 'submit_feedback', description: 'Submit user feedback (rating 1-5) to improve agent responses over time.',
    parameters: { type: 'object', properties: {
      rating: { type: 'number', description: 'Rating 1 (bad) to 5 (excellent)' },
      message: { type: 'string', description: 'Optional user message that triggered this' },
      agentResponse: { type: 'string', description: 'Optional agent response being rated' },
      context: { type: 'string', description: 'Optional context (e.g. "tool-execution", "general-query")' },
    }, required: ['rating'] } },
  { name: 'feedback_stats', description: 'Return feedback statistics: total ratings, average, distribution, recent entries.',
    parameters: { type: 'object', properties: {
      trend: { type: 'boolean', description: 'Include trend analysis (default: false)' },
    }, required: [] } },
  ];
  const pluginDefs = getPluginTools();
  return [...staticDefs, ...pluginDefs];
}

export const toolDefinitions = buildToolDefs();

export async function executeTool(toolName, args, log) {
  switch (toolName) {
    case 'execute_command': {
      const cwd = args.workdir ? path.join(ROOT, args.workdir) : ROOT;
      return safeExec(args.command, cwd);
    }
    case 'read_file': {
      const fp = path.join(ROOT, args.path);
      try {
        if (!fs.existsSync(fp)) return { success: false, output: `File not found: ${args.path}` };
        const content = fs.readFileSync(fp, 'utf-8');
        const lines = content.split('\n');
        const limit = args.limit || 200;
        const shown = lines.slice(0, limit);
        let result = shown.join('\n');
        if (lines.length > limit) result += `\n... [${lines.length - limit} more lines]`;
        return { success: true, output: result };
      } catch (err) {
        return { success: false, output: `Error reading ${args.path}: ${err.message}` };
      }
    }
    case 'write_file': {
      const fp = path.join(ROOT, args.path);
      try {
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, args.content, 'utf-8');
        return { success: true, output: `Written ${args.path} (${args.content.length} chars)` };
      } catch (err) {
        return { success: false, output: `Error writing ${args.path}: ${err.message}` };
      }
    }
    case 'search_files': {
      const searchPath = args.path ? path.join(ROOT, args.path) : ROOT;
      const include = args.include ? `--include="${args.include}"` : '';
      return safeExec(`rg -n ${include} "${args.pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>nul || echo "No matches found"`);
    }
    case 'list_directory': {
      const dir = args.path ? path.join(ROOT, args.path) : ROOT;
      try {
        if (!fs.existsSync(dir)) return { success: false, output: `Directory not found: ${args.path || '.'}` };
        const depth = Math.min(args.depth || 1, 3);
        const items = fs.readdirSync(dir, { withFileTypes: true });
        let out = `Contents of ${args.path || '.'}:\n`;
        for (const item of items) {
          const prefix = item.isDirectory() ? '📁 ' : '📄 ';
          out += `${prefix}${item.name}\n`;
          if (item.isDirectory() && depth > 1) {
            try {
              const sub = fs.readdirSync(path.join(dir, item.name));
              for (const s of sub) out += `  ${s}\n`;
            } catch { }
          }
        }
        return { success: true, output: out };
      } catch (err) {
        return { success: false, output: `Error listing ${args.path || '.'}: ${err.message}` };
      }
    }
    case 'git_command':
      return safeExec(`git ${args.args}`);
    case 'send_message':
      return { success: true, output: args.text, isResponse: true };
    case 'gateway_status': {
      const ctx = getProjectContext();
      const lines = [
        `Gateway: ${ctx.gatewayRunning ? 'RUNNING' : 'STOPPED'}`,
        `Inbox: ${ctx.inboxCount} pending | Outbox: ${ctx.outboxCount} pending`,
        `Schedules: ${ctx.schedulesCount} active`,
        `Platforms:`,
      ];
      for (const [name, enabled] of Object.entries(ctx.platformsActive))
        lines.push(`  ${name}: ${enabled ? 'ENABLED' : 'disabled'}`);
      return { success: true, output: lines.join('\n') };
    }
    case 'process_inbox': {
      const inboxDir = path.join(ROOT, '.session', 'gateway', 'inbox');
      try {
        if (!fs.existsSync(inboxDir)) return { success: true, output: 'No inbox directory found.' };
        const files = fs.readdirSync(inboxDir).filter(f => f.endsWith('.json')).sort();
        if (files.length === 0) return { success: true, output: 'No pending messages.' };
        const processed = [];
        for (const f of files) {
          const fp = path.join(inboxDir, f);
          const raw = fs.readFileSync(fp, 'utf-8');
          const msg = JSON.parse(raw);
          if (!msg.processed) {
            msg.processed = true;
            msg.processedAt = new Date().toISOString();
            fs.writeFileSync(fp, JSON.stringify(msg, null, 2));
            processed.push({ file: f, platform: msg.platform, from: msg.from, text: msg.text });
          }
        }
        const summary = processed.map(m => `[${m.platform}] ${m.from}: ${m.text}`).join('\n');
        return { success: true, output: `Processed ${processed.length} messages:\n${summary}` };
      } catch (err) {
        return { success: false, output: `Error processing inbox: ${err.message}` };
      }
    }
    case 'list_schedules': {
      try {
        if (!fs.existsSync(SCHEDULE_FILE)) return { success: true, output: 'No scheduled tasks.' };
        const tasks = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8'));
        if (!Array.isArray(tasks) || tasks.length === 0) return { success: true, output: 'No scheduled tasks.' };
        const lines = tasks.map(t =>
          `${t.enabled ? '🟢' : '⭕'} ${t.id} | "${t.description}" | cron: ${t.cron} | ${t.platform}${t.lastRun ? ` | last: ${t.lastRun}` : ''}`
        );
        return { success: true, output: `Scheduled Tasks (${tasks.length}):\n${lines.join('\n')}` };
      } catch (err) {
        return { success: false, output: `Error reading schedules: ${err.message}` };
      }
    }
    case 'load_skill': {
      if (!args.name) return { success: false, output: 'Skill name required.' };
      const skillFile = path.join(ROOT, 'skills', args.name, 'SKILL.md');
      try {
        if (!fs.existsSync(skillFile)) {
          const dirs = fs.readdirSync(path.join(ROOT, 'skills'))
            .filter(f => fs.statSync(path.join(ROOT, 'skills', f)).isDirectory());
          return { success: false, output: `Skill "${args.name}" not found. Available: ${dirs.join(', ')}` };
        }
        return { success: true, output: `# ${args.name}\n\n${fs.readFileSync(skillFile, 'utf-8')}` };
      } catch (err) {
        return { success: false, output: `Error loading skill: ${err.message}` };
      }
    }
    case 'session_info': {
      const ctx = getProjectContext();
      const active = Object.entries(ctx.platformsActive).filter(([,v]) => v).map(([k]) => k).join(', ') || 'none';
      return { success: true, output: [
        `Project: ${ctx.projectName}`,
        `Branch: ${ctx.currentBranch} | Commit: ${ctx.lastCommit}`,
        `Engram: ${ctx.engramAvailable ? 'available' : 'not available'} | Skills: ${ctx.skillsCount}`,
        `Gateway: ${ctx.gatewayRunning ? 'RUNNING' : 'STOPPED'} | Platforms: ${active}`,
        `Inbox: ${ctx.inboxCount} | Outbox: ${ctx.outboxCount} | Schedules: ${ctx.schedulesCount}`,
        `Last inbox: ${ctx.lastProcessedAt || 'never'}`,
      ].join('\n') };
    }
    case 'schedule_create': {
      try {
        const cron = parseNLToCron(args.timeExpression) || args.timeExpression;
        const sched = getScheduler();
        const task = sched.addTask(args.description, cron, args.action, args.platform, args.target || '');
        return { success: true, output: `✅ Tarea creada: "${args.description}" → \`${cron}\` (ID: ${task.id})` };
      } catch (err) {
        return { success: false, output: `Error creando tarea: ${err.message}` };
      }
    }
    case 'schedule_list': {
      const sched = getScheduler();
      const tasks = sched.listTasks();
      if (tasks.length === 0) return { success: true, output: 'No hay tareas programadas.' };
      const lines = tasks.map(t =>
        `${t.enabled ? '🟢' : '⭕'} ${t.id} | "${t.description}" | cron: ${t.cron} | ${t.action} | ${t.platform}${t.lastRun ? ` | last: ${t.lastRun.slice(0, 16).replace('T', ' ')}` : ''}`
      );
      return { success: true, output: `📋 Tareas Programadas (${tasks.length}):\n${lines.join('\n')}` };
    }
    case 'schedule_remove': {
      const sched = getScheduler();
      const ok = sched.removeTask(args.taskId);
      return ok
        ? { success: true, output: `✅ Tarea ${args.taskId} eliminada.` }
        : { success: false, output: `❌ Tarea ${args.taskId} no encontrada.` };
    }
    case 'schedule_parse_time': {
      const cron = parseNLToCron(args.text);
      if (cron) return { success: true, output: `"${args.text}" → \`${cron}\`` };
      const examples = listSupportedPatterns().slice(0, 5).join(', ');
      return { success: false, output: `No pude interpretar: "${args.text}". Ejemplos: ${examples}...` };
    }
    case 'submit_feedback': {
      return fbSubmit({
        rating: args.rating,
        message: args.message || '',
        agentResponse: args.agentResponse || '',
        context: args.context || '',
      });
    }
    case 'feedback_stats': {
      const stats = getFeedbackStats();
      if (args.trend) {
        const trend = getFeedbackTrend();
        const lines = [
          `Total feedback: ${stats.total}`,
          `Average: ${stats.avgRating}/5.0`,
          `Distribution: 1★=${stats.counts[1]} 2★=${stats.counts[2]} 3★=${stats.counts[3]} 4★=${stats.counts[4]} 5★=${stats.counts[5]}`,
        ];
        const insights = trend.insights || [];
        if (insights.length > 0) {
          lines.push('Trend insights:', ...insights.map(i => `  - ${i}`));
        }
        return { success: true, output: lines.join('\n') };
      }
      const lines = [
        `Total feedback: ${stats.total}`,
        `Average: ${stats.avgRating}/5.0`,
        `Distribution: 1★=${stats.counts[1]} 2★=${stats.counts[2]} 3★=${stats.counts[3]} 4★=${stats.counts[4]} 5★=${stats.counts[5]}`,
      ];
      if (stats.recent.length > 0) {
        lines.push('Recent:', ...stats.recent.map(r => `  [${r.rating}★] ${r.message.slice(0, 60)}`));
      }
      return { success: true, output: lines.join('\n'), data: stats };
    }
    default: {
      const pluginExec = getPluginExecutor(toolName);
      if (pluginExec) return pluginExec(args, log);
      return { success: false, output: `Unknown tool: ${toolName}` };
    }
  }
}
