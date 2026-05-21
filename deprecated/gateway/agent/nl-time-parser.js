const DAY_NAMES = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
  lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 0,
};

export function getDayNumber(name) {
  if (name == null) return null;
  const key = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return DAY_NAMES[key] ?? null;
}

function extractTime(text) {
  let m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\b/i);
  if (m) {
    let h = parseInt(m[1]), min = m[2] ? parseInt(m[2]) : 0;
    if (/p/i.test(m[3])) { if (h < 12) h += 12; }
    else if (h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { hour: h, min };
  }
  m = text.match(/(\d{1,2}):(\d{2})(?!\s*[ap]\.?\s*m)/i);
  if (m) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { hour: h, min };
  }
  m = text.match(/(?:a\s+)?las\s+(\d{1,2})(?::(\d{2}))?(?:\s+de\s+la\s+(?:manana|mañana|tarde|noche))?/i);
  if (m) {
    let h = parseInt(m[1]), min = m[2] ? parseInt(m[2]) : 0, ctx = m[3] || '';
    if ((ctx === 'tarde' || ctx === 'noche') && h < 12) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { hour: h, min };
  }
  m = text.match(/\bat\s+(\d{1,2})\b/i);
  if (m) {
    let h = parseInt(m[1]);
    if (h >= 0 && h <= 23) return { hour: h, min: 0 };
  }
  return null;
}

export function parseNLToCron(nlExpression) {
  const raw = nlExpression.trim();
  const text = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/(?:each|every|cada)\s+\d+\s+(?:seconds?|segundos?)/.test(text)) return null;
  const time = extractTime(text);
  const hour = time ? time.hour : 0;
  const min = time ? time.min : 0;
  const fmt = `${min} ${hour}`;
  let m;
  m = text.match(/(?:each|every|cada)\s+(\d+)\s+(?:minutes?|minutos?)/);
  if (m) return `*/${m[1]} * * * *`;
  if (/(?:each|every|cada)\s+(?:minute|minuto)\b/.test(text)) return '*/1 * * * *';
  m = text.match(/(?:each|every|cada)\s+(\d+)\s+(?:hours?|horas?)/);
  if (m) return `0 */${m[1]} * * *`;
  if (/(?:each|every|cada)\s+(?:hour|hora)\b/.test(text)) return '0 * * * *';
  if (/(?:monday\s*(?:to|-|through)\s*friday|weekdays?|lunes\s*(?:a|al|y)\s*viernes|dia\s+de\s+semana|dias?\s+habiles?)/.test(text))
    return `${fmt} * * 1-5`;
  if (/(?:weekends?|finde|fin\s+de\s+semana)/.test(text))
    return `${fmt} * * 0,6`;
  for (const [name, num] of Object.entries(DAY_NAMES)) {
    const e = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    if (new RegExp(`(?:each|every)\\s+${e}\\b|(?:cada|los)\\s+${e}\\b`).test(text))
      return `${fmt} * * ${num}`;
  }
  if (/\b(?:morning|manana)\b/.test(text)) {
    const h = time ? time.hour : 8;
    const m = time ? time.min : 0;
    return `${m} ${h} * * *`;
  }
  if (/\b(?:afternoon|tarde)\b/.test(text)) {
    const h = time ? time.hour : 18;
    const m = time ? time.min : 0;
    return `${m} ${h} * * *`;
  }
  if (/\b(?:night|evening|noche)\b/.test(text)) {
    const h = time ? time.hour : 21;
    const m = time ? time.min : 0;
    return `${m} ${h} * * *`;
  }
  if (/\b(?:daily|cada\s+dia|todos?\s+los\s+dias?|diario|diariamente)\b/.test(text))
    return `${fmt} * * *`;
  if (/\b(?:every\s+)?day\b/.test(text))
    return time ? `${fmt} * * *` : '0 0 * * *';
  if (/\b(?:weekly|cada\s+semana|semanal(?:mente)?)\b/.test(text))
    return '0 0 * * 0';
  if (/\b(?:monthly|cada\s+mes|mensual(?:mente)?)\b/.test(text))
    return '0 0 1 * *';
  if (time) {
    const now = new Date();
    let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, min, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return `${min} ${hour} ${target.getDate()} ${target.getMonth() + 1} *`;
  }
  return null;
}

export function listSupportedPatterns() {
  return [
    'every 5 minutes', 'every 2 hours', 'every day at 9:00',
    'every morning at 8 AM', 'every night at 9 PM',
    'every weekday at 10:00', 'Monday to Friday at 14:30',
    'every Monday at 9 AM', 'on weekends at 10:00',
    'daily', 'weekly', 'monthly', 'at 15:00',
    'cada 5 minutos', 'cada hora', 'todos los dias a las 9',
    'lunes a viernes a las 10', 'cada lunes a las 8 AM',
    'manana', 'tarde', 'noche',
  ];
}
