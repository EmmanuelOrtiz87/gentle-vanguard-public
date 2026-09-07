import type { IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ROOT } from './shared.ts';

// Stub: knowledge query via local search
// TODO: Integrate with real knowledge base when available
interface KnowledgeResult {
  query: string;
  sources: string;
  total: number;
  results: Array<{
    source: string;
    content: string;
    timestamp?: string;
  }>;
  note?: string;
}

export function knowledgeHandler(
  req: IncomingMessage,
  res: ServerResponse,
  headers: Record<string, string>,
) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
  const query = url.searchParams.get('q') || '';
  const sources = url.searchParams.get('sources') || 'events,traces,feedback,checkpoints';
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 20)));
  const results: KnowledgeResult['results'] = [];
  if (terms.length > 0) {
    for (const root of [join(ROOT, 'docs'), join(ROOT, 'knowledge-base'), join(ROOT, 'reports')]) {
      if (!existsSync(root)) continue;
      for (const file of walkFiles(root)
        .filter((path) => /\.(md|txt|json)$/i.test(path))
        .slice(0, 250)) {
        try {
          const content = readFileSync(file, 'utf8');
          if (!terms.every((term) => content.toLowerCase().includes(term))) continue;
          results.push({
            source: file.slice(ROOT.length + 1),
            content: content.slice(0, 1200),
            timestamp: new Date().toISOString(),
          });
          if (results.length >= limit) break;
        } catch {
          /* best effort */
        }
      }
      if (results.length >= limit) break;
    }
  }
  const result: KnowledgeResult = {
    query,
    sources,
    total: results.length,
    results,
    note: 'Local indexed search; semantic RAG enrichment is planned for the next phase',
  };

  res.writeHead(200, headers);
  res.end(JSON.stringify({ type: 'knowledge', data: result }));
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) files.push(...walkFiles(path));
      else files.push(path);
    }
  } catch {
    /* best effort */
  }
  return files;
}
