import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface Reminder {
  id: string;
  from: string;
  through: string;
  timeZone: string;
  message: string;
  guide: string;
}

export function takeSessionReminders(root: string, now = new Date()): string[] {
  const reminders: Reminder[] = JSON.parse(readFileSync(join(root, 'config', 'session-reminders.json'), 'utf8'));
  const delivered: string[] = [];
  for (const { id, from, through, timeZone, message, guide } of reminders) {
    if (!/^[a-z0-9-]+$/.test(id)) continue;
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone }).format(now);
    if (day < from || day > through) continue;
    const state = join(root, '.runtime', 'session-reminders');
    mkdirSync(state, { recursive: true });
    try {
      // Exclusive creation ensures simultaneous session starts share one daily notice.
      writeFileSync(join(state, id + '-' + day), '', { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    delivered.push(`${message}\nGuía: ${resolve(root, guide)}`);
  }
  return delivered;
}
