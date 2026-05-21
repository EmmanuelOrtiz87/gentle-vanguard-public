import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const FEEDBACK_DIR = path.join(ROOT, '.session', 'gateway', 'feedback');
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, 'feedback.jsonl');

fs.mkdirSync(FEEDBACK_DIR, { recursive: true });

export function submitFeedback(entry) {
  const record = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    rating: entry.rating,
    message: (entry.message || '').slice(0, 2000),
    context: entry.context || '',
    platform: entry.platform || 'internal',
    from: entry.from || 'unknown',
    agentResponse: (entry.agentResponse || '').slice(0, 2000),
  };

  if (![1, 2, 3, 4, 5].includes(record.rating)) {
    return { success: false, output: `Invalid rating: ${entry.rating}. Must be 1-5.` };
  }

  fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(record) + '\n', 'utf-8');
  return { success: true, output: `Feedback recorded (rating: ${record.rating})`, id: record.id };
}

export function getFeedbackStats() {
  try {
    if (!fs.existsSync(FEEDBACK_FILE)) {
      return { total: 0, avgRating: 0, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, recent: [] };
    }
    const raw = fs.readFileSync(FEEDBACK_FILE, 'utf-8').trim();
    if (!raw) return { total: 0, avgRating: 0, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, recent: [] };
    const entries = raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    for (const e of entries) {
      if (counts[e.rating] !== undefined) { counts[e.rating]++; sum += e.rating; }
    }
    const recent = entries.slice(-10).reverse().map(e => ({
      id: e.id, rating: e.rating, message: (e.message || '').slice(0, 100), platform: e.platform, timestamp: e.timestamp,
    }));
    return {
      total: entries.length,
      avgRating: entries.length > 0 ? (sum / entries.length).toFixed(2) : 0,
      counts,
      recent,
    };
  } catch (err) {
    return { total: 0, avgRating: 0, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, recent: [], error: err.message };
  }
}

export function getFeedbackTrend() {
  const stats = getFeedbackStats();
  if (stats.total < 5) return { actionable: false, reason: 'Not enough data (< 5 ratings)' };
  const posPercent = ((stats.counts[4] + stats.counts[5]) / stats.total * 100).toFixed(0);
  const negPercent = ((stats.counts[1] + stats.counts[2]) / stats.total * 100).toFixed(0);
  const actionable = [];
  if (negPercent > 30) actionable.push('High negative ratio — review recent negative feedback for patterns');
  if (stats.avgRating < 3.0) actionable.push('Average rating below 3.0 — consider agent prompt adjustments');
  if (stats.total > 20 && posPercent > 80) actionable.push('Consistently high ratings — system is performing well');
  return {
    actionable: actionable.length > 0,
    insights: actionable,
    avgRating: stats.avgRating,
    positivePct: posPercent,
    negativePct: negPercent,
    total: stats.total,
  };
}
