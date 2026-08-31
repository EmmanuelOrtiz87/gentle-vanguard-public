#!/usr/bin/env node
/**
 * Knowledge Synthesizer — Cross-session knowledge distillation for Gentle-Vanguard.
 *
 * Reads from Engram, digests, reflections, audit logs, metrics, and the
 * knowledge base vault to produce structured knowledge artifacts:
 *   - Knowledge maps (concepts and their relationships)
 *   - Trend analyses (concept frequency over time)
 *   - Gap analyses (undocumented areas needing attention)
 *
 * The synthesizer closes the knowledge gap:
 *   Datos → Información → Conocimiento → Sabiduría → Decisión
 *
 * Flags:
 *   --synthesize   Run full synthesis (default)
 *   --map          Generate knowledge map only
 *   --trends       Generate trend analysis only
 *   --gaps         Generate gap analysis only
 *   --output json|md  Output format (default: json)
 *   --quiet        Minimal output (pipeline mode)
 *   --dry-run      Preview without saving
 */

import { main } from './knowledge-synthesizer/index.js';
import { pathToFileURL } from 'url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
