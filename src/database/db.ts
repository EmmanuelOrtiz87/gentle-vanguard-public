/**
 * db.ts — Database access helper for Gentle-Vanguard stack
 *
 * Central re-export of the DatabaseManager singleton for easy importing
 * from anywhere in the stack.
 *
 * Usage:
 *   import { db, DatabaseManager } from '../database/db';
 *
 *   // Get manager singleton
 *   const mgr = db();
 *
 *   // Access raw SQLite handle
 *   const raw = db().getDb();
 *   raw.prepare('SELECT ...');
 */

// We use require() via createRequire for cross-module compatibility
// to import the dashboard's DatabaseManager from src/
import { createRequire } from 'module';
import type { DatabaseManager } from '../../apps/web-dashboard/server/database/manager.js';
const _require = createRequire(import.meta.url);

let _mgr: DatabaseManager | null = null;

/** Get the DatabaseManager singleton (lazy-loaded) */
export function db(): DatabaseManager {
  if (!_mgr) {
    const mod = _require('../../apps/web-dashboard/server/database/manager');
    _mgr = mod.DatabaseManager.getInstance() as DatabaseManager;
  }
  return _mgr;
}

/** Convenience re-export (for use with destructuring imports) */
export const getDb = db;
