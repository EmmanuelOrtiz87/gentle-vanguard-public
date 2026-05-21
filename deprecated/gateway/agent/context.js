import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PID_FILE = path.join(ROOT, '.session', 'gateway', 'gateway.pid');
const INBOX_DIR = path.join(ROOT, '.session', 'gateway', 'inbox');
const OUTBOX_DIR = path.join(ROOT, '.session', 'gateway', 'outbox');
const SCHEDULE_FILE = path.join(ROOT, '.session', 'gateway', 'schedules.json');
const CONFIG_FILE = path.join(ROOT, 'config', 'gateway.json');

function isRunning() {
  try {
    if (!fs.existsSync(PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (!pid) return false;
    try { process.kill(pid, 0); return true; }
    catch { return false; }
  } catch { return false; }
}

function countJson(dir) {
  try {
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
  } catch { return 0; }
}

function getPlatformsActive() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    const platforms = {};
    for (const [name, p] of Object.entries(cfg.platforms || {})) {
      platforms[name] = !!p.enabled;
    }
    return platforms;
  } catch { return {}; }
}

function getSchedulesCount() {
  try {
    if (!fs.existsSync(SCHEDULE_FILE)) return 0;
    const tasks = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8'));
    return Array.isArray(tasks) ? tasks.length : 0;
  } catch { return 0; }
}

function getLastProcessedAt() {
  try {
    if (!fs.existsSync(INBOX_DIR)) return null;
    const files = fs.readdirSync(INBOX_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(INBOX_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return null;
    return new Date(files[0].mtime).toISOString();
  } catch { return null; }
}

export function getProjectContext() {
  const ctx = {
    rootDir: ROOT,
    projectName: 'gentle-vanguard',
    skillsCount: 0,
    engramAvailable: false,
    currentBranch: 'unknown',
    lastCommit: 'unknown',
    gatewayRunning: false,
    inboxCount: 0,
    outboxCount: 0,
    schedulesCount: 0,
    platformsActive: {},
    lastProcessedAt: null,
  };

  try {
    ctx.currentBranch = execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf-8', timeout: 5000 }).trim();
  } catch { }

  try {
    ctx.lastCommit = execSync('git log -1 --format="%h %s"', { cwd: ROOT, encoding: 'utf-8', timeout: 5000 }).trim();
  } catch { }

  try {
    ctx.engramAvailable = !!execSync('pwsh -NoProfile -Command "Get-Command engram -ErrorAction SilentlyContinue"', { cwd: ROOT, encoding: 'utf-8', timeout: 5000 }).trim();
  } catch { ctx.engramAvailable = false; }

  try {
    const skillsDir = path.join(ROOT, 'skills');
    if (fs.existsSync(skillsDir)) {
      ctx.skillsCount = fs.readdirSync(skillsDir).filter(f => {
        try { return fs.statSync(path.join(skillsDir, f)).isDirectory(); } catch { return false; }
      }).length;
    }
  } catch { }

  ctx.gatewayRunning = isRunning();
  ctx.inboxCount = countJson(INBOX_DIR);
  ctx.outboxCount = countJson(OUTBOX_DIR);
  ctx.schedulesCount = getSchedulesCount();
  ctx.platformsActive = getPlatformsActive();
  ctx.lastProcessedAt = getLastProcessedAt();

  return ctx;
}

export class ConversationHistory {
  constructor(maxMessages = 50) {
    this.maxMessages = maxMessages;
    this.messages = [];
  }

  add(role, content) {
    this.messages.push({ role, content });
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }

  get() {
    return this.messages;
  }

  clear() {
    this.messages = [];
  }

  save(filePath) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(this.messages.slice(-20), null, 2));
    } catch { }
  }

  load(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        this.messages = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch { }
  }
}
