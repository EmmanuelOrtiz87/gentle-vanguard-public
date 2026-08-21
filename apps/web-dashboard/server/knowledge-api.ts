import type { IncomingMessage, ServerResponse } from 'http';

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
  // Return empty results - knowledge base integration stub
  // The actual knowledge-query.ps1 was removed during PS1->TS migration
  const result: KnowledgeResult = {
    query,
    sources,
    total: 0,
    results: [],
    note: 'Knowledge base query stub - awaiting TS migration completion',
  };

  res.writeHead(200, headers);
  res.end(JSON.stringify({ type: 'knowledge', data: result }));
}
