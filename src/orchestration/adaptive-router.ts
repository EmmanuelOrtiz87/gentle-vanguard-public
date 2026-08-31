#!/usr/bin/env node
/**
 * Adaptive Router Dinámico — Dynamic routing layer for Gentle-Vanguard.
 *
 * Reads historical performance data from skill usage, metrics, corrections,
 * reflections, and knowledge maps to build a dynamic routing table that
 * overrides the static skill-router when confidence is high enough.
 *
 * The adaptive router closes the routing gap:
 *   Static Rules → Historial de Ejecución → Aprendizaje → Routing Dinámico
 *
 * Flags:
 *   --build       Build/update routing table (default)
 *   --override    Apply routing overrides
 *   --status      Show current routing table summary
 *   --reset       Reset routing table to defaults
 *   --quiet       Minimal output (pipeline mode)
 *   --dry-run     Preview without saving
 */

import { pathToFileURL } from 'url';
import { main } from './adaptive-router/index.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
