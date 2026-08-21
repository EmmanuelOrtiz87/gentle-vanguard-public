#!/usr/bin/env node
/**
 * Session Notification — timezone-aware session peak/off-peak notifications.
 * TS migration of scripts/utilities/session/session-notification.ps1
 */

import { pathToFileURL } from 'url';

interface NotificationOptions {
  sessionId?: string;
  timeZone?: string;
  peakStart?: number;
  peakEnd?: number;
  region?: string;
}

/** Get localized time for a given timezone */
function getLocalizedTime(timeZoneId: string): Date {
  try {
    const now = new Date();
    // Use Intl.DateTimeFormat for timezone conversion
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZoneId,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const getVal = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
    return new Date(
      getVal('year'),
      getVal('month') - 1,
      getVal('day'),
      getVal('hour'),
      getVal('minute'),
      getVal('second'),
    );
  } catch {
    // Fallback: UTC-3 (Argentina)
    const d = new Date();
    d.setHours(d.getHours() - 3);
    return d;
  }
}

/** Get timezone offset string like "-03:00" */
function getTimezoneOffset(timeZoneId: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZoneId,
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    // Extract offset from strings like "GMT-03:00"
    const match = tzPart.match(/GMT([+-]\d{2}:\d{2})/);
    if (match) return match[1];
  } catch {
    // ignore
  }
  return '-03:00';
}

/** Test if current hour is within peak hours */
function isPeakHour(localTime: Date, peakStart: number, peakEnd: number): boolean {
  const hour = localTime.getHours();
  return hour >= peakStart && hour < peakEnd;
}

/** Show peak hour notification */
function showPeakNotification(peakStart: number, peakEnd: number): void {
  console.log('');
  console.log(`====== PEAK HOUR DETECTED (${peakStart}:00 - ${peakEnd}:00) ======`);
  console.log('');
  console.log('  Token consumption is POTENTIALLY HIGH during peak hours.');
  console.log('');
  console.log('  Recommendations:');
  console.log('    - Keep tasks SHORT and CONCISE');
  console.log('    - Avoid heavy or complex tasks');
  console.log('    - Complex tasks should be done at off-peak hours');
  console.log('    - Goal: avoid excessive token waste');
  console.log('');
  console.log('====== End Peak Hour Notice ======');
  console.log('');
}

/** Show off-peak notification */
function showOffPeakNotification(region: string): void {
  console.log('');
  console.log(`====== OFF-PEAK HOURS (${region}) ======`);
  console.log('');
  console.log('  You can operate NORMALLY with large/complex tasks.');
  console.log('');
  console.log('  Advantages of this time:');
  console.log('    - No elevated token consumption');
  console.log('    - Ideal for heavy and complex tasks');
  console.log('    - Weekend work also recommended');
  console.log('    - Outside of peak business hours');
  console.log('');
  console.log('  Enjoy the IA agent without restrictions!');
  console.log('');
  console.log('====== End Off-Peak Notice ======');
  console.log('');
}

/** Main notification logic */
export function showSessionNotification(options: NotificationOptions = {}): void {
  const {
    sessionId = '',
    timeZone = 'America/Argentina/Buenos_Aires',
    peakStart = 9,
    peakEnd = 15,
    region = 'Argentina',
  } = options;

  const localTime = getLocalizedTime(timeZone);
  const offset = getTimezoneOffset(timeZone);

  console.log(`[NOTIFICATION] Current time (${region}): ${formatTime(localTime, offset)}`);

  if (isPeakHour(localTime, peakStart, peakEnd)) {
    showPeakNotification(peakStart, peakEnd);
  } else {
    showOffPeakNotification(region);
  }

  if (sessionId) {
    console.log(`[INFO] Session: ${sessionId}`);
  }
}

function formatTime(date: Date, offset: string): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} ${offset}`;
}

// CLI entry (ESM pattern)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const options: NotificationOptions = {};

  const sidIdx = args.indexOf('--session-id');
  if (sidIdx >= 0) options.sessionId = args[sidIdx + 1];

  const tzIdx = args.indexOf('--timezone');
  if (tzIdx >= 0) options.timeZone = args[tzIdx + 1];

  const psIdx = args.indexOf('--peak-start');
  if (psIdx >= 0) options.peakStart = parseInt(args[psIdx + 1], 10);

  const peIdx = args.indexOf('--peak-end');
  if (peIdx >= 0) options.peakEnd = parseInt(args[peIdx + 1], 10);

  const rIdx = args.indexOf('--region');
  if (rIdx >= 0) options.region = args[rIdx + 1];

  showSessionNotification(options);
}
