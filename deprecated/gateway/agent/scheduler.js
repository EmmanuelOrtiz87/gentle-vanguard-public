import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SCHEDULE_FILE = path.join(ROOT, '.session', 'gateway', 'schedules.json');
const LOG_FILE = path.join(ROOT, '.session', 'gateway', 'scheduler.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG_FILE, line);
}

function parseCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  return { min, hour, dom, mon, dow };
}

function cronMatches(cron, date) {
  const match = (pattern, value) => {
    if (pattern === '*') return true;
    if (pattern.startsWith('*/')) return value % parseInt(pattern.slice(2)) === 0;
    if (pattern.includes(',')) return pattern.split(',').some(p => match(p.trim(), value));
    if (pattern.includes('-')) { const [a, b] = pattern.split('-').map(Number); return value >= a && value <= b; }
    return parseInt(pattern) === value;
  };
  return match(cron.min, date.getMinutes()) && match(cron.hour, date.getHours()) &&
    match(cron.dom, date.getDate()) && match(cron.mon, date.getMonth() + 1) &&
    match(cron.dow, date.getDay());
}

export class Scheduler {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.tasks = [];
    this.interval = null;
    this.lastCheck = null;
  }

  load() {
    try {
      if (fs.existsSync(SCHEDULE_FILE)) {
        this.tasks = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8'));
        this.log(`scheduler: loaded ${this.tasks.length} task(s)`);
      }
    } catch (err) {
      this.log(`scheduler: load error -> ${err.message}`);
      this.tasks = [];
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(SCHEDULE_FILE), { recursive: true });
      fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(this.tasks, null, 2));
    } catch (err) {
      this.log(`scheduler: save error -> ${err.message}`);
    }
  }

  addTask(description, cronExpr, action, platform, target) {
    const parsed = parseCron(cronExpr);
    if (!parsed) throw new Error(`Invalid cron expression: ${cronExpr}`);

    const task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      description,
      cron: cronExpr,
      parsed,
      action,
      platform: platform || 'whatsapp',
      target: target || '',
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRun: null,
      nextRun: null,
    };
    this.tasks.push(task);
    this.save();
    return task;
  }

  removeTask(id) {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.tasks.splice(idx, 1);
    this.save();
    return true;
  }

  listTasks() {
    return this.tasks.map(t => ({
      id: t.id,
      description: t.description,
      cron: t.cron,
      action: t.action,
      platform: t.platform,
      enabled: t.enabled,
      lastRun: t.lastRun,
    }));
  }

  async executeTask(task) {
    this.log(`scheduler: executing ${task.id} (${task.description})`);
    task.lastRun = new Date().toISOString();
    this.save();

    try {
      let result;
      switch (task.action) {
        case 'command':
          result = execSync(task.params?.cmd || 'echo "no command"', { cwd: ROOT, encoding: 'utf-8', timeout: 30000 });
          break;
        case 'git-status':
          result = execSync('git status --short', { cwd: ROOT, encoding: 'utf-8', timeout: 10000 });
          break;
        case 'git-log':
          const count = task.params?.count || 5;
          result = execSync(`git log --oneline -${count}`, { cwd: ROOT, encoding: 'utf-8', timeout: 10000 });
          break;
        case 'report':
          result = `📊 *Reporte Programado*\n\n${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}\n\nProyecto: gentle-vanguard\nTarea: ${task.description}`;
          break;
        case 'nlu':
          result = `[NLU] ${task.params?.cmd || task.description}`;
          break;
        default:
          result = `✅ Ejecutado: ${task.description}`;
      }

      const outFile = path.join(ROOT, '.session', 'gateway', 'outbox', `sched-${task.id}-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify({
        platform: task.platform,
        to: task.target,
        text: typeof result === 'string' ? result : result.toString(),
      }, null, 2));
      this.log(`scheduler: result queued for ${task.platform}`);
    } catch (err) {
      this.log(`scheduler: execution error ${task.id} -> ${err.message}`);
    }
  }

  async tick() {
    const now = new Date();
    if (this.lastCheck && now - this.lastCheck < 30000) return;
    this.lastCheck = now;

    for (const task of this.tasks) {
      if (!task.enabled) continue;
      if (cronMatches(task.parsed, now)) {
        const lastRun = task.lastRun ? new Date(task.lastRun) : null;
        if (!lastRun || (now - lastRun) > 60000) {
          await this.executeTask(task);
        }
      }
    }
  }

  start() {
    this.load();
    this.interval = setInterval(() => this.tick(), 15000);
    this.log('scheduler: started');
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.save();
    this.log('scheduler: stopped');
  }

  formatForDisplay() {
    if (this.tasks.length === 0) return 'No hay tareas programadas.';
    return this.tasks.map((t, i) =>
      `${i + 1}. [${t.enabled ? 'ACTIVO' : 'INACTIVO'}] ${t.description} | cron: "${t.cron}" | action: ${t.action} | platform: ${t.platform}${t.target ? ' -> ' + t.target : ''}${t.lastRun ? ' | last: ' + t.lastRun.slice(0, 16).replace('T', ' ') : ''}`
    ).join('\n');
  }
}

let _schedulerInstance = null;

export function getScheduler(config, log) {
  if (!_schedulerInstance) {
    _schedulerInstance = new Scheduler(
      config || {},
      log || ((msg) => process.stdout.write(`[scheduler] ${msg}\n`))
    );
    _schedulerInstance.load();
  }
  return _schedulerInstance;
}
