import { parseNLToCron, listSupportedPatterns } from './nl-time-parser.js';
import { getScheduler } from './scheduler.js';

function sched() { return getScheduler(); }

export async function handleScheduleCommand(agent, text, from) {
  const t = text.trim().toLowerCase();
  if (/^(?:schedule\s+)?(?:list|tasks?|ver\s+tareas?)/.test(t) || t === 'list') {
    return formatScheduleList(sched().listTasks());
  }
  const rm = t.match(/^(?:schedule\s+)?(?:remove|delete|eliminar)\s+(\S+)/);
  if (rm) {
    const ok = sched().removeTask(rm[1]);
    return ok ? `✅ Tarea ${rm[1]} eliminada.` : `❌ Tarea ${rm[1]} no encontrada.`;
  }
  const re = t.match(/remind\s+(?:me\s+)?(?:to\s+)?(.+?)\s+(?:at|a\s+las)\s+(.+)/i);
  if (re) {
    const desc = re[1].trim(), nlTime = re[2].trim();
    const cron = parseNLToCron(nlTime);
    if (!cron) return `❌ No entendí la hora: "${nlTime}".`;
    const task = sched().addTask(`🔔 Recordatorio: ${desc}`, cron, 'report', agent?.config?.defaultPlatform || 'whatsapp', from);
    return `✅ Recordatorio creado: "${desc}" → \`${cron}\` (ID: ${task.id})`;
  }
  const ad = t.match(/(?:schedule\s+add|schedule|add)\s+(.+?)\s+(report|git-status|command)\s+(?:to|en|para)\s+(\S+)/i);
  if (ad) {
    const nlTime = ad[1].trim(), action = ad[2].toLowerCase(), platform = ad[3].trim();
    const cron = parseNLToCron(nlTime);
    if (!cron) return `❌ No entendí el tiempo: "${nlTime}".`;
    const task = sched().addTask(`Schedule: ${nlTime} ${action}`, cron, action, platform, '');
    return `✅ Tarea creada: "${nlTime} ${action}" → \`${cron}\` (ID: ${task.id})`;
  }
  const se = t.match(/(?:send|enviar)\s+(?:me\s+)?(.+?)\s+(?:every|cada)\s+(.+)/i);
  if (se) {
    const action = se[1].trim(), nlTime = se[2].trim();
    let cron = parseNLToCron(`every ${nlTime}`);
    if (!cron) cron = '*/5 * * * *';
    const task = sched().addTask(`⏰ ${action}`, cron, 'report', agent?.config?.defaultPlatform || 'whatsapp', from);
    return `✅ Programado: "${action}" cada "${nlTime}" → \`${cron}\` (ID: ${task.id})`;
  }
  return null;
}

export async function handleIncomingMessage(agent, text, platform, from, onResponse) {
  if (/^(?:schedule|programar|recordatorio?|remind|tarea)/i.test(text.trim())) {
    const result = await handleScheduleCommand(agent, text, from);
    if (result) {
      if (onResponse) await onResponse(result);
      return true;
    }
  }
  return false;
}

export function formatScheduleList(tasks) {
  if (!tasks || tasks.length === 0) return '📋 No hay tareas programadas.';
  let out = `📋 *Tareas Programadas (${tasks.length})*\n\n`;
  tasks.forEach((t, i) => {
    out += `${i + 1}. *${t.description}*\n   ID: \`${t.id}\` | Cron: \`${t.cron}\`\n   Acción: ${t.action} | Plataforma: ${t.platform}\n`;
    if (t.lastRun) out += `   Última ejec: ${t.lastRun.slice(0, 16).replace('T', ' ')}\n`;
    out += '\n';
  });
  return out;
}
