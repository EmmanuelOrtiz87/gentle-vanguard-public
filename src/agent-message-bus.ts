#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
} from 'fs';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';

interface AgentMessage {
  id: string;
  type: 'request' | 'response' | 'broadcast' | 'event';
  sender: string;
  recipient: string;
  conversation_id: string;
  correlation_id: string;
  subject: string;
  payload: unknown;
  compressedPayload?: string;
  timestamp: string;
  expires_at: string | null;
  priority: 'normal' | 'high' | 'low';
  ack: boolean;
  ackedAt?: string;
}

interface Mailbox {
  agent: string;
  messages: AgentMessage[];
  lastPoll: string | null;
  lastUpdated?: string;
}

interface Conversation {
  conversation_id: string;
  messages: AgentMessage[];
  agents: Record<string, boolean>;
}

interface AgentStatus {
  total: number;
  unread: number;
}

const ROOT = resolve(process.cwd());
const MAILBOX_DIR = join(ROOT, '.event-bus', 'agent-mailboxes');
const LOG_FILE = join(ROOT, '.event-bus', 'agent-messages.jsonl');

function ensureMailboxDir(): void {
  if (!existsSync(MAILBOX_DIR)) {
    mkdirSync(MAILBOX_DIR, { recursive: true });
  }
}

function generateId(prefix = 'msg'): string {
  const now = new Date();
  const ts =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0') +
    String(now.getMilliseconds()).padStart(3, '0');
  const rand = randomBytes(4).toString('hex');
  return `${prefix}-${ts}-${rand}`;
}

function generateConversationId(prefix = 'conv'): string {
  const now = new Date();
  const ts =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  const rand = randomBytes(3).toString('hex');
  return `${prefix}-${ts}-${rand}`;
}

function mailboxPath(agent: string): string {
  return join(MAILBOX_DIR, `mailbox-${agent}.json`);
}

function readMailbox(agent: string): Mailbox {
  const path = mailboxPath(agent);
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw) as Mailbox;
    } catch {
      return { agent, messages: [], lastPoll: null };
    }
  }
  return { agent, messages: [], lastPoll: null };
}

function writeMailbox(agent: string, data: Mailbox): void {
  const path = mailboxPath(agent);
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

function nowISO(): string {
  return new Date().toISOString();
}

function createMessage(
  type: AgentMessage['type'],
  from: string,
  to: string,
  convId: string,
  corrId: string,
  subject: string,
  payload: string,
  priority: AgentMessage['priority'],
  ttl: number,
): AgentMessage {
  const expires = ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null;
  let parsedPayload: unknown = null;
  if (payload) {
    try {
      parsedPayload = JSON.parse(payload);
    } catch {
      parsedPayload = payload;
    }
  }
  return {
    id: generateId(),
    type,
    sender: from,
    recipient: to,
    conversation_id: convId,
    correlation_id: corrId,
    subject,
    payload: parsedPayload,
    timestamp: nowISO(),
    expires_at: expires,
    priority,
    ack: false,
  };
}

function removeExpired(mailbox: Mailbox): Mailbox {
  const now = Date.now();
  mailbox.messages = mailbox.messages.filter((m) => {
    if (!m.expires_at) return true;
    try {
      return new Date(m.expires_at).getTime() >= now;
    } catch {
      return true;
    }
  });
  return mailbox;
}

function logEvent(msgId: string, from: string, to: string, subject: string, type: string): void {
  const logDir = join(ROOT, '.event-bus');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const entry = JSON.stringify({
    timestamp: nowISO(),
    message_id: msgId,
    sender: from,
    recipient: to,
    subject,
    type,
  });
  appendFileSync(LOG_FILE, entry + '\n', 'utf-8');
}

function parseArgs(): Record<string, string | boolean | number> {
  const args: Record<string, string | boolean | number> = {};
  const validActions = [
    'send',
    'poll',
    'ack',
    'list-conversations',
    'list-mailbox',
    'purge',
    'status',
  ];
  const validTypes = ['request', 'response', 'broadcast', 'event'];
  const validPriorities = ['normal', 'high', 'low'];

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        args[key] = val;
      } else {
        const key = arg.slice(2);
        const next = process.argv[i + 1];
        if (next && !next.startsWith('--')) {
          args[key] = next;
          i++;
        } else {
          args[key] = true;
        }
      }
    }
  }

  if (!args.action || !validActions.includes(args.action as string)) {
    args.action = 'status';
  }
  if (args.messageType && !validTypes.includes(args.messageType as string)) {
    args.messageType = 'request';
  }
  if (args.priority && !validPriorities.includes(args.priority as string)) {
    args.priority = 'normal';
  }
  if (args.ttlSeconds !== undefined) args.ttlSeconds = Number(args.ttlSeconds) || 300;
  if (args.limit !== undefined) args.limit = Number(args.limit) || 20;

  return args;
}

function log(msg: string, silent: boolean): void {
  if (!silent) console.log(msg);
}

function cmdSend(args: Record<string, string | boolean | number>): void {
  const sender = (args.fromAgent as string) || (args.sender as string) || '';
  const recipient = (args.recipient as string) || '';
  if (!sender || !recipient) {
    if (args.asJson) {
      console.log(JSON.stringify({ error: 'Sender and Recipient required' }));
      return;
    }
    console.error('[ERROR] Sender and Recipient required');
    process.exit(1);
  }

  const convId = (args.conversationId as string) || generateConversationId();
  const msg = createMessage(
    (args.messageType as AgentMessage['type']) || 'request',
    sender,
    recipient,
    convId,
    (args.correlationId as string) || '',
    (args.subject as string) || '',
    (args.payload as string) || '',
    (args.priority as AgentMessage['priority']) || 'normal',
    Number(args.ttlSeconds) || 300,
  );

  ensureMailboxDir();
  const mb = removeExpired(readMailbox(recipient));
  mb.messages.push(msg);
  mb.lastUpdated = nowISO();
  writeMailbox(recipient, mb);

  logEvent(msg.id, sender, recipient, msg.subject, msg.type);
  log(`[MSG] ${msg.id} ${sender}->${recipient} [${msg.type}] ${msg.subject}`, !!args.silent);

  if (args.asJson) console.log(JSON.stringify(msg, null, 2));
}

function cmdPoll(args: Record<string, string | boolean | number>): void {
  const recipient = (args.recipient as string) || '';
  if (!recipient) {
    if (args.asJson) {
      console.log(JSON.stringify({ error: 'Recipient required' }));
      return;
    }
    console.error('[ERROR] Recipient required');
    process.exit(1);
  }

  ensureMailboxDir();
  const mb = removeExpired(readMailbox(recipient));
  mb.lastPoll = nowISO();

  let results = mb.messages.filter((m) => !m.ack);
  if (args.conversationId)
    results = results.filter((m) => m.conversation_id === args.conversationId);
  if (args.subject) results = results.filter((m) => m.subject === args.subject);
  if (args.sender) results = results.filter((m) => m.sender === args.sender);

  const priorityOrder: Record<string, number> = { high: 0, normal: 1, low: 2 };
  results.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 1;
    const pb = priorityOrder[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    return a.timestamp.localeCompare(b.timestamp);
  });

  const limit = Number(args.limit) || 20;
  if (results.length > limit) results = results.slice(0, limit);

  writeMailbox(recipient, mb);
  log(`[POLL] ${recipient}: ${results.length} unread messages`, !!args.silent);

  if (args.asJson) {
    console.log(
      JSON.stringify({ agent: recipient, count: results.length, messages: results }, null, 2),
    );
    return;
  }
  if (results.length === 0) return;
  for (const m of results) {
    const color =
      m.priority === 'high' ? '\x1b[33m' : m.priority === 'low' ? '\x1b[90m' : '\x1b[37m';
    console.log(`${color}  [${m.priority}] ${m.id} ${m.sender} [${m.type}] ${m.subject}\x1b[0m`);
  }
}

function cmdAck(args: Record<string, string | boolean | number>): void {
  const msgId = (args.messageId as string) || '';
  const recipient = (args.recipient as string) || '';
  if (!msgId || !recipient) {
    if (args.asJson) {
      console.log(JSON.stringify({ error: 'MessageId and Recipient required' }));
      return;
    }
    console.error('[ERROR] MessageId and Recipient required');
    process.exit(1);
  }

  ensureMailboxDir();
  const mb = readMailbox(recipient);
  removeExpired(mb);
  const found = mb.messages.find((m) => m.id === msgId);
  if (found) {
    found.ack = true;
    found.ackedAt = nowISO();
    writeMailbox(recipient, mb);
    log(`[ACK] ${msgId} acknowledged`, !!args.silent);
    if (args.asJson) console.log(JSON.stringify({ status: 'acknowledged', message_id: msgId }));
  } else {
    log(`[WARN] Message ${msgId} not found in ${recipient} mailbox`, !!args.silent);
    if (args.asJson) console.log(JSON.stringify({ status: 'not-found', message_id: msgId }));
  }
}

function cmdListConversations(args: Record<string, string | boolean | number>): void {
  ensureMailboxDir();
  const files = existsSync(MAILBOX_DIR)
    ? readdirSync(MAILBOX_DIR).filter((f) => f.startsWith('mailbox-') && f.endsWith('.json'))
    : [];
  const convs: Record<string, Conversation> = {};

  for (const f of files) {
    const raw = readFileSync(join(MAILBOX_DIR, f), 'utf-8');
    const mb: Mailbox = JSON.parse(raw);
    for (const m of mb.messages) {
      if (
        m.conversation_id &&
        (!args.conversationId || m.conversation_id === args.conversationId)
      ) {
        if (!convs[m.conversation_id]) {
          convs[m.conversation_id] = {
            conversation_id: m.conversation_id,
            messages: [],
            agents: {},
          };
        }
        convs[m.conversation_id].messages.push(m);
        convs[m.conversation_id].agents[m.sender] = true;
        if (m.recipient) convs[m.conversation_id].agents[m.recipient] = true;
      }
    }
  }

  if (args.asJson) {
    console.log(JSON.stringify({ conversations: Object.values(convs) }, null, 2));
    return;
  }
  const convIds = Object.keys(convs).sort();
  log(`=== Conversations (${convIds.length}) ===`, !!args.silent);
  for (const cid of convIds) {
    const c = convs[cid];
    const agents = Object.keys(c.agents).join(',');
    const count = c.messages.length;
    const last = c.messages[c.messages.length - 1]?.timestamp ?? 'N/A';
    console.log(`  \x1b[32m${cid}\x1b[0m`);
    console.log(`    Agents: ${agents} | Messages: ${count} | Last: ${last}`);
  }
}

function cmdListMailbox(args: Record<string, string | boolean | number>): void {
  ensureMailboxDir();
  const recipient = (args.recipient as string) || '';

  if (!recipient) {
    const files = existsSync(MAILBOX_DIR)
      ? readdirSync(MAILBOX_DIR).filter((f) => f.startsWith('mailbox-') && f.endsWith('.json'))
      : [];
    log('=== Mailboxes ===', !!args.silent);
    for (const f of files) {
      const raw = readFileSync(join(MAILBOX_DIR, f), 'utf-8');
      const mb: Mailbox = JSON.parse(raw);
      const unread = mb.messages.filter((m) => !m.ack).length;
      const total = mb.messages.length;
      const color = unread > 0 ? '\x1b[33m' : '\x1b[32m';
      console.log(`${color}  ${mb.agent}: ${unread} unread / ${total} total\x1b[0m`);
    }
    return;
  }

  const mb = removeExpired(readMailbox(recipient));
  if (args.asJson) {
    console.log(JSON.stringify(mb, null, 2));
    return;
  }
  const unread = mb.messages.filter((m) => !m.ack).length;
  log(`=== Mailbox: ${recipient} (${unread} unread) ===`, !!args.silent);
  for (const m of mb.messages) {
    const mark = m.ack ? '[X]' : '[ ]';
    const color = m.priority === 'high' ? '\x1b[33m' : m.ack ? '\x1b[90m' : '\x1b[37m';
    console.log(
      `${color}  ${mark} ${m.id} ${m.sender}->${m.recipient} [${m.type}] ${m.subject}\x1b[0m`,
    );
  }
  writeMailbox(recipient, mb);
}

function cmdPurge(args: Record<string, string | boolean | number>): void {
  ensureMailboxDir();
  const recipient = (args.recipient as string) || '';
  let count = 0;

  if (recipient) {
    const mb = readMailbox(recipient);
    const before = mb.messages.length;
    if (args.messageId) {
      mb.messages = mb.messages.filter((m) => m.id !== args.messageId);
    } else if (args.conversationId) {
      mb.messages = mb.messages.filter((m) => m.conversation_id !== args.conversationId);
    } else if (args.subject) {
      mb.messages = mb.messages.filter((m) => m.subject !== args.subject);
    } else {
      mb.messages = [];
    }
    count = before - mb.messages.length;
    writeMailbox(recipient, mb);
  } else {
    const files = existsSync(MAILBOX_DIR)
      ? readdirSync(MAILBOX_DIR).filter((f) => f.startsWith('mailbox-') && f.endsWith('.json'))
      : [];
    for (const f of files) {
      const path = join(MAILBOX_DIR, f);
      try {
        const raw = readFileSync(path, 'utf-8');
        const mb: Mailbox = JSON.parse(raw);
        count += mb.messages.length;
        mb.messages = [];
        writeFileSync(path, JSON.stringify(mb, null, 2), 'utf-8');
      } catch {
        /* skip corrupt */
      }
    }
  }

  log(`[PURGE] Removed ${count} items`, !!args.silent);
  if (args.asJson) console.log(JSON.stringify({ removed: count }));
}

function cmdStatus(args: Record<string, string | boolean | number>): void {
  ensureMailboxDir();
  const files = existsSync(MAILBOX_DIR)
    ? readdirSync(MAILBOX_DIR).filter((f) => f.startsWith('mailbox-') && f.endsWith('.json'))
    : [];
  let totalMessages = 0;
  let unreadMessages = 0;
  const agentMailboxes: Record<string, AgentStatus> = {};

  for (const f of files) {
    const raw = readFileSync(join(MAILBOX_DIR, f), 'utf-8');
    const mb: Mailbox = JSON.parse(raw);
    const unread = mb.messages.filter((m) => !m.ack).length;
    totalMessages += mb.messages.length;
    unreadMessages += unread;
    agentMailboxes[mb.agent] = { total: mb.messages.length, unread };
  }

  let totalLogged = 0;
  if (existsSync(LOG_FILE)) {
    try {
      const content = readFileSync(LOG_FILE, 'utf-8').trim();
      totalLogged = content ? content.split('\n').length : 0;
    } catch {
      /* ignore */
    }
  }

  if (args.asJson) {
    console.log(
      JSON.stringify(
        {
          mailboxes: agentMailboxes,
          agentCount: files.length,
          totalMessages,
          unreadMessages,
          totalLogged,
        },
        null,
        2,
      ),
    );
    return;
  }

  const unreadColor = unreadMessages > 0 ? '\x1b[33m' : '\x1b[32m';
  log('=== Agent Message Bus ===', !!args.silent);
  console.log(`  Mailbox dir: ${MAILBOX_DIR}`);
  console.log(`  Agents: ${files.length}`);
  console.log(`${unreadColor}  Messages: ${totalMessages} total, ${unreadMessages} unread\x1b[0m`);
  console.log(`  Logged: ${totalLogged} entries`);
}

function main(): void {
  const args = parseArgs();
  const action = args.action as string;

  switch (action) {
    case 'send':
      cmdSend(args);
      break;
    case 'poll':
      cmdPoll(args);
      break;
    case 'ack':
      cmdAck(args);
      break;
    case 'list-conversations':
      cmdListConversations(args);
      break;
    case 'list-mailbox':
      cmdListMailbox(args);
      break;
    case 'purge':
      cmdPurge(args);
      break;
    case 'status':
      cmdStatus(args);
      break;
    default:
      cmdStatus(args);
      break;
  }
}

main();
