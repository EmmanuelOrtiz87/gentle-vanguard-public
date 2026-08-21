export interface MCPServerInfo {
  name: string;
  type: 'builtin' | 'user';
  transport: 'stdio' | 'sse';
  command: string;
  args: string[];
  enabled: boolean;
  autoStart: boolean;
  description: string;
}

export interface MCPServerStatus {
  name: string;
  pid: number | null;
  status: 'running' | 'stopped' | 'error';
  uptime: number;
  toolsCount: number;
  lastError: string | null;
}

export interface MCPRegistry {
  version: string;
  description: string;
  servers: MCPServerInfo[];
}
