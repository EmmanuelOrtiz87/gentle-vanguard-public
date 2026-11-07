#!/usr/bin/env tsx
/**
 * Multi-Channel Alert System (MCAS)
 *
 * Sistema de alertas multi-canal para Gentle-Vanguard.
 * Soporta: CLI, Dashboard, File, Webhook, Discord, Slack,
 *          Telegram, WhatsApp (Twilio), SMS (Twilio), Email (SMTP).
 *
 * Usage:
 *   npx tsx src/monitor/multi-channel-alert.ts --send "Test message" --severity warning
 *   npx tsx src/monitor/multi-channel-alert.ts --monitor    # Modo monitor
 *   npx tsx src/monitor/multi-channel-alert.ts --test         # Test all channels
 *
 * @version 1.0.0
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const STATE_DIR = join(ROOT, '.runtime', 'alert-system');
const LOG_FILE = join(STATE_DIR, 'alerts.log');

mkdirSync(STATE_DIR, { recursive: true });

// ─── Configuration ────────────────────────────────────────────────────────────
interface AlertConfig {
  enabled: boolean;
  webhook?: string;
  discord?: string;
  slack?: string;
  channel?: string;
  username?: string;
  avatarUrl?: string;
  /** Telegram: token del bot + chat destino. */
  telegramToken?: string;
  telegramChatId?: string;
  /** Override para tests (default https://api.telegram.org). */
  telegramApiBase?: string;
  /** Twilio WhatsApp / SMS: credenciales de la cuenta. */
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFrom?: string;
  twilioTo?: string;
  /** Override para tests (default https://api.twilio.com). */
  twilioApiBase?: string;
  /** Email vía SMTP (nodemailer). */
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  emailTo?: string;
  /** Transporte inyectable para tests (default: nodemailer lazy). */
  transport?: { sendMail(opts: Record<string, unknown>): Promise<unknown> };
}

interface MCASConfig {
  channels: {
    cli: boolean;
    file: boolean;
    dashboard: boolean;
    webhook: AlertConfig;
    discord: AlertConfig;
    slack: AlertConfig;
    telegram: AlertConfig;
    whatsapp: AlertConfig;
    sms: AlertConfig;
    email: AlertConfig;
  };
  defaults: {
    severity: 'info' | 'warning' | 'critical' | 'emergency';
    cooldownSeconds: number;
    maxAlertsPerMinute: number;
  };
  severityColors: {
    info: string;
    warning: string;
    critical: string;
    emergency: string;
  };
}

/**
 * Canales externos: se activan SOLOS si el owner define la env var.
 *
 * Antes eran `enabled: false` FIJOS: setting DISCORD_WEBHOOK_URL no activaba
 * nada, y el codigo de los docs ("se activan solos si existen las env vars")
 * era falso. Ademas la URL se guardaba en `webhook` mientras los emisores leen
 * `config.discord` / `config.slack` — o sea, aunque `enabled` fuera true, el
 * emisor recibia undefined y salia sin enviar. El canal quedaba muerto por
 * partida doble.
 *
 * La derivacion vive en una funcion pura (`buildExternalChannels`) para que el
 * contrato sea verificable sin tocar `process.env` global.
 */
export function buildExternalChannels(env: Record<string, string | undefined> = process.env): {
  webhook: AlertConfig;
  discord: AlertConfig;
  slack: AlertConfig;
  telegram: AlertConfig;
  whatsapp: AlertConfig;
  sms: AlertConfig;
  email: AlertConfig;
} {
  return {
    webhook: {
      enabled: Boolean(env.ALERT_WEBHOOK_URL),
      webhook: env.ALERT_WEBHOOK_URL,
    },
    discord: {
      enabled: Boolean(env.DISCORD_WEBHOOK_URL),
      discord: env.DISCORD_WEBHOOK_URL,
      username: 'Gentle-Vanguard',
      avatarUrl: 'https://github.com/opencode-ai.png',
    },
    slack: {
      enabled: Boolean(env.SLACK_WEBHOOK_URL),
      slack: env.SLACK_WEBHOOK_URL,
      channel: '#alerts',
      username: 'Gentle-Vanguard',
    },
    telegram: {
      enabled: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
      telegramToken: env.TELEGRAM_BOT_TOKEN,
      telegramChatId: env.TELEGRAM_CHAT_ID,
      telegramApiBase: env.TELEGRAM_API_BASE || 'https://api.telegram.org',
    },
    whatsapp: {
      enabled: Boolean(
        env.WHATSAPP_ACCOUNT_SID && env.WHATSAPP_AUTH_TOKEN && env.WHATSAPP_FROM && env.WHATSAPP_TO,
      ),
      twilioAccountSid: env.WHATSAPP_ACCOUNT_SID,
      twilioAuthToken: env.WHATSAPP_AUTH_TOKEN,
      twilioFrom: env.WHATSAPP_FROM,
      twilioTo: env.WHATSAPP_TO,
      twilioApiBase: env.WHATSAPP_API_BASE || 'https://api.twilio.com',
    },
    sms: {
      enabled: Boolean(env.SMS_ACCOUNT_SID && env.SMS_AUTH_TOKEN && env.SMS_FROM && env.SMS_TO),
      twilioAccountSid: env.SMS_ACCOUNT_SID,
      twilioAuthToken: env.SMS_AUTH_TOKEN,
      twilioFrom: env.SMS_FROM,
      twilioTo: env.SMS_TO,
      twilioApiBase: env.SMS_API_BASE || 'https://api.twilio.com',
    },
    email: {
      enabled: Boolean(env.SMTP_HOST && env.ALERT_EMAIL_TO),
      smtpHost: env.SMTP_HOST,
      smtpPort: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
      smtpUser: env.SMTP_USER,
      smtpPass: env.SMTP_PASS,
      smtpFrom: env.SMTP_FROM || env.SMTP_USER,
      emailTo: env.ALERT_EMAIL_TO,
    },
  };
}

/** Config completa derivable de un entorno (puro, testeable). */
export function buildConfig(env: Record<string, string | undefined> = process.env): MCASConfig {
  return {
    channels: {
      cli: true,
      file: true,
      dashboard: true,
      ...buildExternalChannels(env),
    },
    defaults: {
      severity: 'info',
      cooldownSeconds: 5,
      maxAlertsPerMinute: 20,
    },
    severityColors: {
      info: '#3498db',
      warning: '#f1c40f',
      critical: '#e74c3c',
      emergency: '#8e44ad',
    },
  };
}

const DEFAULT_CONFIG: MCASConfig = buildConfig(process.env);

// ─── Logger ─────────────────────────────────────────────────────────────────────
type Severity = AlertPayload['severity'];

const SEVERITIES: readonly Severity[] = ['info', 'warning', 'critical', 'emergency'];

function isSeverity(value: string | undefined): value is Severity {
  return value !== undefined && (SEVERITIES as readonly string[]).includes(value);
}

/** Discord embed field shape (per Discord webhook API). */
interface DiscordEmbedField {
  name: string;
  value: string;
  inline: boolean;
}

/** Slack attachment field shape (per Slack incoming-webhook API). */
interface SlackAttachmentField {
  title: string;
  value: string;
  short: boolean;
}

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n', 'utf-8');
}

// ─── State Management ─────────────────────────────────────────────────────────
interface AlertState {
  lastAlertTime: number;
  alertCount: number;
  alertsThisMinute: number;
  lastMinuteReset: number;
}

function loadState(): AlertState {
  const stateFile = join(STATE_DIR, 'state.json');
  try {
    if (existsSync(stateFile)) {
      return JSON.parse(readFileSync(stateFile, 'utf-8'));
    }
  } catch {}
  return {
    lastAlertTime: 0,
    alertCount: 0,
    alertsThisMinute: 0,
    lastMinuteReset: Date.now(),
  };
}

function saveState(state: AlertState): void {
  writeFileSync(join(STATE_DIR, 'state.json'), JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Alert Interface ────────────────────────────────────────────────────────────
interface AlertPayload {
  id: string;
  severity: 'info' | 'warning' | 'critical' | 'emergency';
  category: string;
  message: string;
  details?: string;
  recommendation?: string;
  metrics?: Record<string, any>;
  timestamp: string;
  sessionId?: string;
}

// ─── Channel Handlers ───────────────────────────────────────────────────────────

async function sendToCli(alert: AlertPayload): Promise<void> {
  const emoji = {
    info: 'ℹ️',
    warning: '⚠️',
    critical: '🔴',
    emergency: '🆘',
  }[alert.severity];

  const color = {
    info: '\x1b[36m',
    warning: '\x1b[33m',
    critical: '\x1b[31m',
    emergency: '\x1b[35m',
  }[alert.severity];

  const reset = '\x1b[0m';

  const banner = `
${color}╔════════════════════════════════════════════════════════════════════════╗${reset}
${color}║ ${emoji} ALERT: ${alert.severity.toUpperCase().padEnd(62)} ${emoji}  ║${reset}
${color}╠════════════════════════════════════════════════════════════════════════╣${reset}
${color}║ Category: ${alert.category.padEnd(62)}║${reset}
${color}║ Time: ${new Date(alert.timestamp).toISOString().padEnd(66)}║${reset}
${color}╠════════════════════════════════════════════════════════════════════════╣${reset}
${color}║ ${alert.message.padEnd(70)}║${reset}
`;

  let details = '';
  if (alert.details) {
    details = `${color}╠════════════════════════════════════════════════════════════════════════╣${reset}
${color}║ Details: ${alert.details.substring(0, 62).padEnd(62)}║${reset}
`;
  }

  let recommendation = '';
  if (alert.recommendation) {
    recommendation = `${color}╠════════════════════════════════════════════════════════════════════════╣${reset}
${color}║ 💡 ${alert.recommendation.substring(0, 64).padEnd(64)}║${reset}
`;
  }

  const footer = `${color}╚════════════════════════════════════════════════════════════════════════╝${reset}
`;

  console.log(banner + details + recommendation + footer);
}

async function sendToFile(alert: AlertPayload): Promise<void> {
  const entry = {
    ...alert,
    receivedAt: new Date().toISOString(),
  };
  appendFileSync(join(STATE_DIR, 'alerts.jsonl'), JSON.stringify(entry) + '\n', 'utf-8');
}

async function sendToDashboard(alert: AlertPayload): Promise<void> {
  const dashboardPath = join(ROOT, '.session', 'alerts', 'realtime.json');
  mkdirSync(join(ROOT, '.session', 'alerts'), { recursive: true });

  let alerts: AlertPayload[] = [];
  try {
    if (existsSync(dashboardPath)) {
      alerts = JSON.parse(readFileSync(dashboardPath, 'utf-8'));
    }
  } catch {}

  alerts.push(alert);
  // Keep last 100 alerts
  if (alerts.length > 100) alerts = alerts.slice(-100);

  writeFileSync(dashboardPath, JSON.stringify(alerts, null, 2), 'utf-8');
}

async function sendToWebhook(alert: AlertPayload, config: AlertConfig): Promise<boolean> {
  if (!config.enabled || !config.webhook) return false;

  try {
    const response = await fetch(config.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alert: alert.severity,
        category: alert.category,
        message: alert.message,
        details: alert.details,
        recommendation: alert.recommendation,
        timestamp: alert.timestamp,
      }),
    });

    return response.ok;
  } catch (err) {
    log(`Webhook failed: ${err}`, 'ERROR');
    return false;
  }
}

async function sendToDiscord(alert: AlertPayload, config: AlertConfig): Promise<boolean> {
  if (!config.enabled || !config.discord) return false;

  const color = DEFAULT_CONFIG.severityColors[alert.severity];

  const embed = {
    title: `${alert.severity.toUpperCase()}: ${alert.category}`,
    description: alert.message,
    color: parseInt(color.replace('#', ''), 16),
    timestamp: alert.timestamp,
    fields: [] as DiscordEmbedField[],
    footer: {
      text: 'Gentle-Vanguard Alert System',
    },
  };

  if (alert.details) {
    embed.fields.push({ name: 'Details', value: alert.details.substring(0, 1024), inline: false });
  }

  if (alert.recommendation) {
    embed.fields.push({
      name: 'Recommendation',
      value: alert.recommendation.substring(0, 1024),
      inline: false,
    });
  }

  if (alert.metrics) {
    Object.entries(alert.metrics).forEach(([key, value]) => {
      embed.fields.push({
        name: key,
        value: String(value).substring(0, 1024),
        inline: true,
      });
    });
  }

  try {
    const response = await fetch(config.discord, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: config.username || 'Gentle-Vanguard',
        avatar_url: config.avatarUrl,
        embeds: [embed],
      }),
    });

    return response.ok;
  } catch (err) {
    log(`Discord failed: ${err}`, 'ERROR');
    return false;
  }
}

async function sendToSlack(alert: AlertPayload, config: AlertConfig): Promise<boolean> {
  if (!config.enabled || !config.slack) return false;

  const emoji = {
    info: ':information_source:',
    warning: ':warning:',
    critical: ':x:',
    emergency: ':rotating_light:',
  }[alert.severity];

  const color = {
    info: '#3498db',
    warning: '#f1c40f',
    critical: '#e74c3c',
    emergency: '#8e44ad',
  }[alert.severity];

  const attachment = {
    fallback: `${alert.severity}: ${alert.message}`,
    color: color,
    title: `${emoji} ${alert.severity.toUpperCase()}: ${alert.category}`,
    text: alert.message,
    ts: Math.floor(new Date(alert.timestamp).getTime() / 1000),
    fields: [] as SlackAttachmentField[],
  };

  if (alert.details) {
    attachment.fields.push({
      title: 'Details',
      value: alert.details.substring(0, 1024),
      short: false,
    });
  }

  if (alert.recommendation) {
    attachment.fields.push({
      title: 'Recommendation',
      value: alert.recommendation.substring(0, 1024),
      short: false,
    });
  }

  try {
    const response = await fetch(config.slack, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: config.username || 'Gentle-Vanguard',
        channel: config.channel,
        attachments: [attachment],
      }),
    });

    return response.ok;
  } catch (err) {
    log(`Slack failed: ${err}`, 'ERROR');
    return false;
  }
}

/** Telegram Bot API: POST {apiBase}/bot{token}/sendMessage {chat_id, text}. */
async function sendToTelegram(alert: AlertPayload, config: AlertConfig): Promise<boolean> {
  if (!config.enabled || !config.telegramToken || !config.telegramChatId) return false;

  const text = [
    `${alert.severity.toUpperCase()}: ${alert.category}`,
    alert.message,
    alert.details ? `\nDetalles: ${alert.details}` : '',
    alert.recommendation ? `\nAccion: ${alert.recommendation}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const url = `${config.telegramApiBase}/bot${config.telegramToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    return response.ok;
  } catch (err) {
    log(`Telegram failed: ${err}`, 'ERROR');
    return false;
  }
}

/**
 * Twilio Messages.json — mismo REST que usa gv-agenda/wa-reminders (fetch
 * nativo, cero dependencias). Sirve para WhatsApp (To = 'whatsapp:+...') y
 * SMS (To = '+549...'); lo decide el FROM/TO configurado, no el codigo.
 */
async function sendToTwilio(
  alert: AlertPayload,
  config: AlertConfig,
  channel: 'whatsapp' | 'sms',
): Promise<boolean> {
  if (!config.enabled || !config.twilioAccountSid || !config.twilioAuthToken) return false;

  const body = [
    `${alert.severity.toUpperCase()}: ${alert.category}`,
    alert.message,
    alert.details ? `Detalles: ${alert.details}` : '',
    alert.recommendation ? `Accion: ${alert.recommendation}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const url = `${config.twilioApiBase}/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;
    const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString(
      'base64',
    );
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: config.twilioFrom ?? '',
        To: config.twilioTo ?? '',
        Body: body,
      }).toString(),
    });
    return response.ok;
  } catch (err) {
    log(`${channel} failed: ${err}`, 'ERROR');
    return false;
  }
}

/**
 * Email vía SMTP. Sin credenciales no hay transporte: el canal queda
 * deshabilitado por env gating. Para tests el transporte se inyecta en
 * `config.transport`; en producción se importa nodemailer lazy (solo cuando
 * el canal está habilitado) para no pagar el require en cada alerta.
 */
async function sendToEmail(alert: AlertPayload, config: AlertConfig): Promise<boolean> {
  if (!config.enabled || !config.smtpHost || !config.emailTo) return false;

  let transport = config.transport;
  if (!transport) {
    try {
      const nodemailer = await import('nodemailer');
      transport = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort ?? 587,
        secure: (config.smtpPort ?? 587) === 465,
        auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
      });
    } catch (err) {
      log(`Email transport unavailable: ${err}`, 'ERROR');
      return false;
    }
  }

  try {
    await transport.sendMail({
      from: config.smtpFrom ?? 'gentle-vanguard@localhost',
      to: config.emailTo,
      subject: `[GV ${alert.severity.toUpperCase()}] ${alert.category}: ${alert.message.slice(0, 80)}`,
      text: [
        `${alert.severity.toUpperCase()}: ${alert.category}`,
        alert.message,
        alert.details ? `\nDetalles: ${alert.details}` : '',
        alert.recommendation ? `\nAccion: ${alert.recommendation}` : '',
        `\nFecha: ${alert.timestamp}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    return true;
  } catch (err) {
    log(`Email failed: ${err}`, 'ERROR');
    return false;
  }
}

// ─── Main Alert Handler ─────────────────────────────────────────────────────────
async function sendAlert(
  payload: Partial<AlertPayload>,
  config: MCASConfig = DEFAULT_CONFIG,
): Promise<{ sent: string[]; failed: string[] }> {
  const state = loadState();

  // Rate limiting check
  const now = Date.now();
  if (now - state.lastMinuteReset > 60000) {
    state.alertsThisMinute = 0;
    state.lastMinuteReset = now;
  }

  if (state.alertsThisMinute >= config.defaults.maxAlertsPerMinute) {
    log(`Rate limit exceeded: ${state.alertsThisMinute} alerts this minute`, 'WARN');
    return { sent: [], failed: ['rate-limited'] };
  }

  // Cooldown check
  if (now - state.lastAlertTime < config.defaults.cooldownSeconds * 1000) {
    log(`Cooldown active: ${config.defaults.cooldownSeconds}s`, 'INFO');
  }

  // Build full payload
  const alert: AlertPayload = {
    id: `alert-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    severity: payload.severity || 'info',
    category: payload.category || 'general',
    message: payload.message || 'No message',
    details: payload.details,
    recommendation: payload.recommendation,
    metrics: payload.metrics,
    timestamp: new Date().toISOString(),
    sessionId: process.env.SESSION_ID || 'unknown',
  };

  const sent: string[] = [];
  const failed: string[] = [];

  // Send to each enabled channel
  if (config.channels.cli) {
    try {
      await sendToCli(alert);
      sent.push('cli');
    } catch {
      failed.push('cli');
    }
  }

  if (config.channels.file) {
    try {
      await sendToFile(alert);
      sent.push('file');
    } catch {
      failed.push('file');
    }
  }

  if (config.channels.dashboard) {
    try {
      await sendToDashboard(alert);
      sent.push('dashboard');
    } catch {
      failed.push('dashboard');
    }
  }

  if (config.channels.webhook.enabled) {
    const success = await sendToWebhook(alert, config.channels.webhook);
    if (success) sent.push('webhook');
    else failed.push('webhook');
  }

  if (config.channels.discord.enabled) {
    const success = await sendToDiscord(alert, config.channels.discord);
    if (success) sent.push('discord');
    else failed.push('discord');
  }

  if (config.channels.slack.enabled) {
    const success = await sendToSlack(alert, config.channels.slack);
    if (success) sent.push('slack');
    else failed.push('slack');
  }

  if (config.channels.telegram.enabled) {
    const success = await sendToTelegram(alert, config.channels.telegram);
    if (success) sent.push('telegram');
    else failed.push('telegram');
  }

  if (config.channels.whatsapp.enabled) {
    const success = await sendToTwilio(alert, config.channels.whatsapp, 'whatsapp');
    if (success) sent.push('whatsapp');
    else failed.push('whatsapp');
  }

  if (config.channels.sms.enabled) {
    const success = await sendToTwilio(alert, config.channels.sms, 'sms');
    if (success) sent.push('sms');
    else failed.push('sms');
  }

  if (config.channels.email.enabled) {
    const success = await sendToEmail(alert, config.channels.email);
    if (success) sent.push('email');
    else failed.push('email');
  }

  // Update state
  state.lastAlertTime = now;
  state.alertCount++;
  state.alertsThisMinute++;
  saveState(state);

  log(`Alert sent to: ${sent.join(', ') || 'none'}`, 'INFO');

  return { sent, failed };
}

// ─── Monitor Mode ─────────────────────────────────────────────────────────────────
async function runMonitor(): Promise<void> {
  log('Starting Multi-Channel Alert System monitor...');

  // Monitor interval (cada 10 segundos)
  const monitorInterval = setInterval(async () => {
    try {
      // Check for issues from other systems
      const alertFile = join(ROOT, '.session', 'alerts', 'pending.json');
      if (existsSync(alertFile)) {
        const pending = JSON.parse(readFileSync(alertFile, 'utf-8'));
        if (Array.isArray(pending) && pending.length > 0) {
          for (const alert of pending) {
            await sendAlert(alert);
          }
          // Clear pending
          writeFileSync(alertFile, '[]', 'utf-8');
        }
      }
    } catch (err) {
      log(`Monitor error: ${err}`, 'ERROR');
    }
  }, 10000);

  // Graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(monitorInterval);
    log('Monitor stopped');
    process.exit(0);
  });

  log('Monitor running. Press Ctrl+C to stop.');
}

// ─── Test All Channels ──────────────────────────────────────────────────────────
async function testAllChannels(): Promise<void> {
  log('Testing all channels...', 'INFO');

  const testAlert: Partial<AlertPayload> = {
    severity: 'info',
    category: 'test',
    message: 'Multi-Channel Alert System test',
    details: 'This is a test alert to verify all channels are working',
    recommendation: 'If you see this, the system is working correctly',
  };

  const result = await sendAlert(testAlert);

  console.log('\n=== TEST RESULTS ===');
  console.log('Sent:', result.sent.join(', ') || 'None');
  console.log('Failed:', result.failed.join(', ') || 'None');

  if (result.failed.length > 0) {
    console.log('\nTroubleshooting:');
    result.failed.forEach((channel) => {
      if (channel === 'webhook') console.log('  - Webhook: Set ALERT_WEBHOOK_URL env var');
      if (channel === 'discord') console.log('  - Discord: Set DISCORD_WEBHOOK_URL env var');
      if (channel === 'slack') console.log('  - Slack: Set SLACK_WEBHOOK_URL env var');
      if (channel === 'telegram')
        console.log('  - Telegram: Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars');
      if (channel === 'whatsapp')
        console.log('  - WhatsApp: Set WHATSAPP_ACCOUNT_SID + WHATSAPP_AUTH_TOKEN + WHATSAPP_FROM + WHATSAPP_TO env vars (Twilio)');
      if (channel === 'sms')
        console.log('  - SMS: Set SMS_ACCOUNT_SID + SMS_AUTH_TOKEN + SMS_FROM + SMS_TO env vars (Twilio)');
      if (channel === 'email')
        console.log('  - Email: Set SMTP_HOST + ALERT_EMAIL_TO (+ SMTP_USER/PASS/PORT) env vars');
    });
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--send')) {
    const messageIndex = args.indexOf('--send') + 1;
    const message = args[messageIndex] || 'Test alert';

    const severityIndex = args.indexOf('--severity') + 1;
    const severityArg = args[severityIndex];
    const severity: Severity = isSeverity(severityArg) ? severityArg : 'info';

    const categoryIndex = args.indexOf('--category') + 1;
    const category = args[categoryIndex] || 'cli';

    const result = await sendAlert({
      severity,
      category,
      message,
    });

    console.log('Sent to:', result.sent.join(', ') || 'None');
    process.exit(0);
  } else if (args.includes('--monitor')) {
    await runMonitor();
  } else if (args.includes('--test')) {
    await testAllChannels();
    process.exit(0);
  } else if (args.includes('--status')) {
    const state = loadState();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     Multi-Channel Alert System Status                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`Total alerts: ${state.alertCount}`);
    console.log(
      `Alerts this minute: ${state.alertsThisMinute}/${DEFAULT_CONFIG.defaults.maxAlertsPerMinute}`,
    );
    console.log(
      `Last alert: ${state.lastAlertTime ? new Date(state.lastAlertTime).toISOString() : 'Never'}`,
    );
    console.log('');
    console.log('Channels:');
    console.log(`  CLI:       ${DEFAULT_CONFIG.channels.cli ? '✅' : '❌'}`);
    console.log(`  File:      ${DEFAULT_CONFIG.channels.file ? '✅' : '❌'}`);
    console.log(`  Dashboard: ${DEFAULT_CONFIG.channels.dashboard ? '✅' : '❌'}`);
    console.log(
      `  Webhook:   ${DEFAULT_CONFIG.channels.webhook.enabled ? '✅' : '❌'} ${process.env.ALERT_WEBHOOK_URL ? '(configured)' : '(not set)'}`,
    );
    console.log(
      `  Discord:   ${DEFAULT_CONFIG.channels.discord.enabled ? '✅' : '❌'} ${process.env.DISCORD_WEBHOOK_URL ? '(configured)' : '(not set)'}`,
    );
    console.log(
      `  Slack:     ${DEFAULT_CONFIG.channels.slack.enabled ? '✅' : '❌'} ${process.env.SLACK_WEBHOOK_URL ? '(configured)' : '(not set)'}`,
    );
    console.log(
      `  Telegram:  ${DEFAULT_CONFIG.channels.telegram.enabled ? '✅' : '❌'} ${process.env.TELEGRAM_BOT_TOKEN ? '(configured)' : '(not set: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)'}`,
    );
    console.log(
      `  WhatsApp:  ${DEFAULT_CONFIG.channels.whatsapp.enabled ? '✅' : '❌'} ${process.env.WHATSAPP_ACCOUNT_SID ? '(configured)' : '(not set: WHATSAPP_ACCOUNT_SID/AUTH_TOKEN/FROM/TO — Twilio)'}`,
    );
    console.log(
      `  SMS:       ${DEFAULT_CONFIG.channels.sms.enabled ? '✅' : '❌'} ${process.env.SMS_ACCOUNT_SID ? '(configured)' : '(not set: SMS_ACCOUNT_SID/AUTH_TOKEN/FROM/TO — Twilio)'}`,
    );
    console.log(
      `  Email:     ${DEFAULT_CONFIG.channels.email.enabled ? '✅' : '❌'} ${process.env.SMTP_HOST ? '(configured)' : '(not set: SMTP_HOST + ALERT_EMAIL_TO [+ SMTP_USER/PASS])'}`,
    );
    console.log('');
  } else if (args.includes('--demo')) {
    // Demo all severity levels
    console.log('\n=== DEMO: All Severity Levels ===\n');

    for (const severity of ['info', 'warning', 'critical', 'emergency'] as const) {
      console.log(`\n--- ${severity.toUpperCase()} ---`);
      await sendAlert({
        severity,
        category: 'demo',
        message: `This is a ${severity} level test alert`,
        details: 'Demo details',
        recommendation:
          severity === 'critical' || severity === 'emergency'
            ? 'Take immediate action'
            : 'Monitor situation',
      });
      await new Promise((r) => setTimeout(r, 1000));
    }

    process.exit(0);
  } else {
    console.log('Multi-Channel Alert System v1.0.0');
    console.log('');
    console.log('Usage:');
    console.log('  --send "message" --severity [info|warning|critical|emergency] --category [cat]');
    console.log('  --monitor                                    Start monitor daemon');
    console.log('  --test                                       Test all channels');
    console.log('  --demo                                       Show all severity levels');
    console.log('  --status                                     Show system status');
    console.log('');
    console.log('Environment Variables:');
    console.log('  ALERT_WEBHOOK_URL     Generic webhook URL');
    console.log('  DISCORD_WEBHOOK_URL   Discord webhook URL');
    console.log('  SLACK_WEBHOOK_URL     Slack webhook URL');
    console.log('');
    console.log('Examples:');
    console.log(
      '  npx tsx src/monitor/multi-channel-alert.ts --send "Server down" --severity critical',
    );
    console.log('  npx tsx src/monitor/multi-channel-alert.ts --test');
    console.log('  npx tsx src/monitor/multi-channel-alert.ts --demo');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    log(`Fatal error: ${err}`, 'ERROR');
    process.exit(1);
  });
}

export { sendAlert };
export type { AlertPayload, AlertConfig, MCASConfig };
