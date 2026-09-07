#!/usr/bin/env node
import { db } from '../database/db.js';
import { pathToFileURL } from 'url';
import type { AlertRecord } from '../database/nexus//manager.js';

function formatAlert(alert: AlertRecord): string {
  return `[${alert.severity.toUpperCase()}] ${alert.name} (${alert.rule}) — actual=${alert.actual} threshold=${alert.threshold} created_at=${alert.created_at}`;
}

function main(): number {
  try {
    const dbm = db();
    const alerts = dbm.getTriggeredAlerts() as AlertRecord[];
    const validationAlerts = alerts.filter((a) => a.rule === 'opencode.validation');

    if (validationAlerts.length === 0) {
      console.log('No active OpenCode validation alerts.');
      return 0;
    }

    console.error(`Found ${validationAlerts.length} active OpenCode validation alert(s):`);
    validationAlerts.forEach((alert) => {
      console.error(formatAlert(alert));
    });

    return 1;
  } catch (err) {
    console.error(
      'Failed to query Nexus alert store:',
      err instanceof Error ? err.message : String(err),
    );
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main };
