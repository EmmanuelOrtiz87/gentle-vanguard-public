import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Globe,
  Cpu,
  Play,
  Square,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  PauseCircle,
  Plus,
  Server,
  Clock,
} from 'lucide-react';

interface MeshServer {
  name: string;
  type: string;
  status: string;
  pid: number | null;
  autoStart: boolean;
  description: string;
}

interface MeshWorkspace {
  name: string;
  path: string;
  servers: MeshServer[];
  status: string;
}

const AUTO_REFRESH_MS = 30000;

function MultiRepoViewInner() {
  const [workspaces, setWorkspaces] = useState<MeshWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [pollError, setPollError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMesh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/mesh');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const msg = await res.json();
      if (msg.type === 'mesh') {
        setWorkspaces(msg.data.workspaces || []);
        setPollError(false);
      }
    } catch {
      if (!silent) setPollError(true);
    }
    if (!silent) setLoading(false);
    setLastChecked(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => {
    void fetchMesh();
    intervalRef.current = setInterval(() => void fetchMesh(true), AUTO_REFRESH_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchMesh]);

  const handleDiscover = async () => {
    setDiscovering(true);
    try {
      await fetch('/api/mesh/discover', { method: 'POST' });
      setTimeout(() => void fetchMesh(), 1000);
    } catch {
      /* ignore */
    }
    setDiscovering(false);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/mesh/sync', { method: 'POST' });
      setTimeout(() => void fetchMesh(), 1000);
    } catch {
      /* ignore */
    }
    setSyncing(false);
  };

  const toggleServer = async (name: string, action: 'start' | 'stop') => {
    try {
      await fetch(`/api/mcp/servers/${name}/${action}`, { method: 'POST' });
      setTimeout(() => void fetchMesh(), 1000);
    } catch {
      /* ignore */
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <PauseCircle className="w-4 h-4 text-gray-400" />;
    }
  };

  const repoStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'degraded':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      default:
        return <PauseCircle className="w-5 h-5 text-gray-400" />;
    }
  };

  const countByStatus = (servers: MeshServer[]) => ({
    running: servers.filter((s) => s.status === 'running').length,
    stopped: servers.filter((s) => s.status !== 'running' && s.status !== 'error').length,
    error: servers.filter((s) => s.status === 'error').length,
  });

  const totalServers = workspaces.reduce((acc, w) => acc + w.servers.length, 0);
  const totalRunning = workspaces.reduce((acc, w) => acc + countByStatus(w.servers).running, 0);
  const totalError = workspaces.reduce((acc, w) => acc + countByStatus(w.servers).error, 0);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Multi-repo Mesh</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            MCP server orchestration across {workspaces.length} workspace(s)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pollError && (
            <span className="text-xs text-red-500 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> API error
            </span>
          )}
          {lastChecked && !pollError && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {lastChecked}
            </span>
          )}
          <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
            {totalServers} servers · {totalRunning} running
            {totalError > 0 && <span className="text-red-500 ml-1">· {totalError} errors</span>}
          </span>
          <button
            onClick={handleDiscover}
            disabled={discovering}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <Plus className={`w-4 h-4 ${discovering ? 'animate-spin' : ''}`} /> Discover
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <Server className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> Sync
          </button>
          <button
            onClick={() => void fetchMesh()}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {loading && workspaces.length === 0 ? (
          <div className="p-8 text-center text-gray-500 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
            Loading mesh workspaces...
          </div>
        ) : pollError && workspaces.length === 0 ? (
          <div className="p-8 text-center bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <AlertCircle className="w-10 h-10 mx-auto mb-2 text-red-500" />
            <p className="text-gray-500">Failed to load mesh data.</p>
            <button
              onClick={() => void fetchMesh()}
              className="mt-2 text-sm text-blue-600 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : workspaces.length === 0 ? (
          <div className="p-8 text-center text-gray-500 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <Globe className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No mesh workspaces found.</p>
            <p className="text-xs mt-1">
              Configure peers in config/federation-config.json or click Discover.
            </p>
          </div>
        ) : (
          workspaces.map((ws) => {
            const counts = countByStatus(ws.servers);
            const isExpanded = expanded === ws.name;
            return (
              <div
                key={ws.name}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700"
              >
                <button
                  onClick={() => setExpanded(isExpanded ? null : ws.name)}
                  className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-750"
                >
                  <div className="flex items-center gap-3">
                    {repoStatusIcon(ws.status)}
                    <div className="text-left">
                      <div className="font-medium text-gray-900 dark:text-white">{ws.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{ws.path}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {counts.running > 0 && (
                      <span className="text-green-500">{counts.running} running</span>
                    )}
                    {counts.error > 0 && <span className="text-red-500">{counts.error} error</span>}
                    {counts.stopped > 0 && (
                      <span className="text-gray-400">{counts.stopped} stopped</span>
                    )}
                    <span className="text-gray-400 font-medium">{ws.servers.length} servers</span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                    {ws.servers.length === 0 ? (
                      <div className="px-4 py-3 pl-12 text-sm text-gray-500">
                        No MCP servers configured
                      </div>
                    ) : (
                      ws.servers.map((s) => (
                        <div
                          key={s.name}
                          className="flex items-center justify-between px-4 py-3 pl-12"
                        >
                          <div className="flex items-center gap-3">
                            <Cpu className="w-4 h-4 text-gray-400" />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900 dark:text-white">
                                  {s.name}
                                </span>
                                <span
                                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                                    s.type === 'builtin'
                                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                      : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                  }`}
                                >
                                  {s.type}
                                </span>
                                <span className="text-xs text-gray-500">{s.description}</span>
                              </div>
                              {s.pid && <div className="text-xs text-gray-400">PID {s.pid}</div>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {statusIcon(s.status)}
                            <span className="text-xs text-gray-500 mr-2">{s.status}</span>
                            {s.status === 'running' ? (
                              <button
                                onClick={() => toggleServer(s.name, 'stop')}
                                className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                              >
                                <Square className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                onClick={() => toggleServer(s.name, 'start')}
                                className="p-1 text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                              >
                                <Play className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default MultiRepoViewInner;
