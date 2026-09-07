export interface UIHint {
  type: 'metric' | 'datatable' | 'form' | 'chart' | 'alert' | 'diff' | 'list';
  label?: string;
  description?: string;
  value?: string | number;
  color?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  fields?: UIFormField[];
  action?: string;
  series?: UISeries[];
  severity?: 'info' | 'warning' | 'error';
  items?: string[];
  oldValue?: string;
  newValue?: string;
}

export interface UIFormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'textarea';
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

export interface UISeries {
  name: string;
  data: number[];
  color?: string;
}

export interface AgentToolCall {
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentMessage {
  id: string;
  agent: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  streaming?: boolean;
  toolCalls?: AgentToolCall[];
  uiHints?: UIHint[];
  metadata?: Record<string, unknown>;
}

export interface AgentSession {
  id: string;
  agent: string;
  status: 'idle' | 'active' | 'awaiting_input' | 'completed' | 'error';
  messages: AgentMessage[];
  createdAt: string;
  updatedAt: string;
  context?: Record<string, unknown>;
}

export interface AgentStreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'ui_hint' | 'status' | 'error' | 'done';
  messageId: string;
  sessionId: string;
  content?: string;
  toolCall?: AgentToolCall;
  uiHint?: UIHint;
  status?: string;
  error?: string;
}

export interface AgentCommand {
  type: 'execute_skill' | 'list_skills' | 'get_skill' | 'search_skills' | 'send_message' | 'cancel';
  agent?: string;
  skill?: string;
  params?: Record<string, unknown>;
  query?: string;
  message?: string;
  sessionId?: string;
}

export type HitlKind = 'confirmation' | 'selection' | 'form' | 'review';

export interface HitlRequest {
  id: string;
  kind: HitlKind;
  title: string;
  message?: string;
  options?: string[];
  fields?: UIFormField[];
  review?: { label: string; value: string; severity?: 'info' | 'warning' | 'error' }[];
  timeoutMs?: number;
  sessionId?: string;
}

export interface HitlResponse {
  requestId: string;
  kind: HitlKind;
  approved?: boolean;
  selection?: string;
  values?: Record<string, unknown>;
  reviewed?: boolean;
  timedOut?: boolean;
  sessionId?: string;
}

export const UI_HINTS_SCHEMA_VERSION = '1.0.0';
