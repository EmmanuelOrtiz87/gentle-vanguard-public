import { useState, useEffect, useCallback } from 'react';
import type { MCPServerInfo, MCPServerStatus } from '../types/mcp';
import { Cpu, Play, Square, RefreshCw, Plus, X } from 'lucide-react';
import { useT } from '../hooks/useLocale';

function MCPServersInner() {
  const { tt } = useT();
  const [servers, setServers] = useState<(MCPServerInfo & MCPServerStatus)[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCmd, setNewCmd] = useState('');
  const [newArgs, setNewArgs] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const fetchServers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mcp/servers');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const msg = await res.json();
      if (msg.type === 'mcp-servers') {
        setServers(msg.data.servers || []);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchServers();
  }, [fetchServers]);

  const toggleServer = async (name: string, action: 'start' | 'stop') => {
    try {
      await fetch(`/api/mcp/servers/${name}/${action}`, { method: 'POST' });
      setTimeout(fetchServers, 1000);
    } catch {
      /* ignore */
    }
  };

  const addServer = async () => {
    if (!newName || !newCmd) return;
    try {
      await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          name: newName,
          command: newCmd,
          args: newArgs.split(' ').filter(Boolean),
          description: newDesc,
        }),
      });
      setShowAdd(false);
      setNewName('');
      setNewCmd('');
      setNewArgs('');
      setNewDesc('');
      setTimeout(fetchServers, 1000);
    } catch {
      /* ignore */
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'text-green-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{tt('ui.mcp_servers')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage local MCP server connections
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> Add Server
          </button>
          <button
            onClick={fetchServers}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-white">{tt('ui.register_mcp_server')}</h3>
            <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Server name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <input
              placeholder="Command (e.g. npx)"
              value={newCmd}
              onChange={(e) => setNewCmd(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <input
              placeholder="Args (space separated)"
              value={newArgs}
              onChange={(e) => setNewArgs(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <input
              placeholder="Description"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <button
            onClick={addServer}
            className="mt-3 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700"
          >
            Register
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        {loading && servers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">{tt('ui.loading_mcp_servers')}</div>
        ) : servers.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Cpu className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{tt('ui.no_mcp_servers_registered')}</p>
              <p className="text-xs mt-1">{tt('ui.add_server_get_started')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {servers.map((s) => (
              <div key={s.name} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Cpu className={`w-5 h-5 ${statusColor(s.status)}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-white">{s.name}</span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full ${
                          s.type === 'builtin'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                        }`}
                      >
                        {s.type}
                      </span>
                      <span className={`text-xs font-medium ${statusColor(s.status)}`}>
                        {s.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {s.description}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {s.command} {s.args.join(' ')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {s.pid && <span className="text-xs text-gray-400">PID {s.pid}</span>}
                  {s.status === 'running' ? (
                    <button
                      onClick={() => toggleServer(s.name, 'stop')}
                      className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                      title="Stop"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleServer(s.name, 'start')}
                      className="p-1.5 text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                      title="Start"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MCPServersInner;
