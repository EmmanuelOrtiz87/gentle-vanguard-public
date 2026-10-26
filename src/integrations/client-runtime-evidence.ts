/** Evidence freshness is separate from availability and collector success. */
export interface ProbeRecord {
  recordedAt: string;
  fingerprint: string;
  result: { qualified: boolean; reason: string; scope?: string };
}
const DAY = 86400000;
export function bindingObservation(confirmed: boolean | null) {
  return {
    identityConfirmed: confirmed,
    status: confirmed === null ? 'host-identity-unavailable' : confirmed ? 'binding-confirmed' : 'host-event-required',
    action: confirmed === null ? 'Supply the real host-provided session ID for read-only resolution; collector cannot infer host registration'
      : confirmed ? 'Use returned host identity; assess writes separately' : 'Genuine host startup/resume must register; no model registration or attributed writes',
  };
}
export function freshProbe(value: unknown, fingerprint: string, now = Date.now()): ProbeRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as ProbeRecord;
  const age = now - Date.parse(record.recordedAt);
  if (!fingerprint || record.fingerprint !== fingerprint || !Number.isFinite(age) || age < 0 || age > DAY ||
    typeof record.result?.qualified !== 'boolean' || typeof record.result?.reason !== 'string') return null;
  return record;
}
export function inventoryCoverage(value: unknown, now = Date.now()) {
  const record = value as { capturedAt?: string; servers?: Array<{ tools?: string[]; error?: string }> } | null;
  const age = now - Date.parse(record?.capturedAt ?? '');
  const servers = Array.isArray(record?.servers) ? record.servers : [];
  const valid = servers.filter(server => server && typeof server === 'object' &&
    Array.isArray(server.tools) && server.tools.every(tool => typeof tool === 'string') &&
    (server.error === undefined || typeof server.error === 'string'));
  const invalid = servers.length - valid.length;
  return {
    fresh: Number.isFinite(age) && age >= 0 && age <= DAY && servers.length > 0 && invalid === 0,
    connected: valid.filter(server => !server.error && server.tools!.length > 0).length,
    failed: invalid + valid.filter(server => server.error ? !server.error.startsWith('remote-oauth') : !server.tools?.length).length,
    deferred: valid.filter(server => server.error?.startsWith('remote-oauth')).length,
  };
}
export function qualificationExit(input: { complete: boolean; observe: boolean; collected: boolean }): number {
  if (!input.collected) return 1;
  return input.complete || input.observe ? 0 : 2;
}
