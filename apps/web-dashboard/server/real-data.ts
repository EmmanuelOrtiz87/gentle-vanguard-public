/**
 * real-data.ts — Dashboard data pipeline backed by SQLite
 *
 * REPLACES the previous JSON-file-based pipeline with database queries.
 * The DatabaseManager writes metric_snapshots every 30s (via MetricsWriter),
 * and this file reads from those snapshots for real-time dashboard data.
 *
 * Falls back to JSON files only when the DB has no data yet (cold start).
 *
 * Barrel: per-domain modules live in ./real-data/ (F2.5 split).
 */
export * from './real-data/helpers.ts';
export * from './real-data/swarm.ts';
export * from './real-data/metrics.ts';
export * from './real-data/traces.ts';
export * from './real-data/usage.ts';
export * from './real-data/capabilities.ts';
