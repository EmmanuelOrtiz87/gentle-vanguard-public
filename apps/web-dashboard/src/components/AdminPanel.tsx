import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, Trash2, UserPlus, KeyRound } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface Membership {
  tenantId: string;
  principalId: string;
  role: string;
  createdAt: string;
}

interface Principal {
  id: string;
  subject: string;
  displayName?: string;
  createdAt: string;
  memberships?: Membership[];
}

const ROLES = ['viewer', 'operator', 'admin'] as const;

const roleBadge = (role: string) => {
  switch (role) {
    case 'admin':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';
    case 'operator':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
  }
};

export default function AdminPanel() {
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [subject, setSubject] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [newRole, setNewRole] = useState<(typeof ROLES)[number]>('viewer');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/principals');
      if (res.status === 403) {
        setError('Admin role required. Sign in with the operator token to manage principals.');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { principals?: Principal[] };
      setPrincipals(body.principals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load principals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  };

  const createPrincipal = async () => {
    if (!subject.trim()) return;
    setError(null);
    try {
      const res = await apiFetch('/api/admin/principals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), displayName: displayName.trim(), role: newRole }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setShowCreate(false);
      setSubject('');
      setDisplayName('');
      setNewRole('viewer');
      flash(`Principal "${subject.trim()}" created`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create principal');
    }
  };

  const changeRole = async (principalId: string, tenantId: string, role: string) => {
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/principals/${principalId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, tenantId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      flash('Role updated');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change role');
    }
  };

  const revokeSessions = async (principalId: string) => {
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/principals/${principalId}/revoke-sessions`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as { revoked?: number; error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      flash(`Revoked ${body.revoked ?? 0} session(s)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke sessions');
    }
  };

  const deletePrincipal = async (principal: Principal) => {
    if (!window.confirm(`Delete principal "${principal.subject}"? Memberships and sessions are removed.`)) {
      return;
    }
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/principals/${principal.id}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      flash(`Principal "${principal.subject}" deleted`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete principal');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6" /> Access Administration
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Principals, tenant memberships and session revocation (RBAC policy v1).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
            aria-label="Reload principals"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Reload
          </button>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            <UserPlus className="w-4 h-4" /> New principal
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300">
          {notice}
        </div>
      )}

      {showCreate && (
        <div className="mb-6 rounded-lg border p-4 shadow-sm space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              className="rounded border p-2 text-sm"
              placeholder="Subject (unique)"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <input
              className="rounded border p-2 text-sm"
              placeholder="Display name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <select
              className="rounded border p-2 text-sm"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as (typeof ROLES)[number])}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => void createPrincipal()}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            Create principal
          </button>
        </div>
      )}

      <div className="space-y-4">
        {loading && principals.length === 0 && (
          <div className="rounded-lg border p-6 text-sm text-gray-500">Loading…</div>
        )}
        {!loading && principals.length === 0 && !error && (
          <div className="rounded-lg border p-6 text-sm text-gray-500">No principals found.</div>
        )}
        {principals.map((p) => (
          <div
            key={p.id}
            className="rounded-lg border bg-white p-4 shadow-sm dark:bg-gray-800 dark:border-gray-700"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium text-gray-900 dark:text-white">{p.subject}</div>
                {p.displayName && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">{p.displayName}</div>
                )}
                <div className="text-xs text-gray-400">id: {p.id}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void revokeSessions(p.id)}
                  className="inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-700"
                  title="Revoke all sessions for this principal"
                >
                  <KeyRound className="w-3.5 h-3.5" /> Revoke sessions
                </button>
                <button
                  onClick={() => void deletePrincipal(p)}
                  className="inline-flex items-center gap-1 rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
                  title="Delete principal"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(p.memberships ?? []).length === 0 && (
                <span className="text-xs text-gray-400">No memberships</span>
              )}
              {(p.memberships ?? []).map((m) => (
                <span
                  key={`${m.tenantId}`}
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                >
                  <span className="text-gray-500">{m.tenantId}</span>
                  <span className={`rounded-full px-2 py-0.5 font-medium ${roleBadge(m.role)}`}>
                    {m.role}
                  </span>
                  <select
                    className="rounded border bg-transparent text-xs"
                    value={m.role}
                    onChange={(e) => void changeRole(p.id, m.tenantId, e.target.value)}
                    aria-label={`Role for ${p.subject} in ${m.tenantId}`}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
