import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Plus,
  MessageSquare,
  Bot,
  Wifi,
  WifiOff,
  Loader2,
  Terminal,
  History,
  Sparkles,
  Bug,
  TestTube,
  Square,
} from 'lucide-react';
import { useAgentStream } from '../hooks/useAgentStream';
import { AgentMessage } from './AgentMessage';
import HitlModal from './HitlModal';
import type { AgentSession } from '../types/agent';

const AGENTS = [
  { code: 'DEV', name: 'Developer', color: 'blue' },
  { code: 'QA', name: 'Quality Assurance', color: 'green' },
  { code: 'BA', name: 'Business Analysis', color: 'yellow' },
  { code: 'GOV', name: 'Governance', color: 'purple' },
  { code: 'OPS', name: 'Operations', color: 'orange' },
  { code: 'DOC', name: 'Documentation', color: 'teal' },
];

const SUGGESTED_ACTIONS = [
  {
    label: 'Run tests',
    icon: TestTube,
    query: 'Execute the test suite and report results',
    agent: 'QA',
  },
  {
    label: 'Check skills',
    icon: Terminal,
    query: 'List all available skills and their status',
    agent: 'DEV',
  },
  {
    label: 'Review logs',
    icon: Bug,
    query: 'Review recent agent logs for errors or warnings',
    agent: 'OPS',
  },
  {
    label: 'Analyze',
    icon: Sparkles,
    query: 'Analyze the current project state and suggest improvements',
    agent: 'BA',
  },
];

export default function AgentChat() {
  const {
    session,
    connected,
    bridgeConnected,
    agentSessions,
    tools,
    hitlRequest,
    historySessions,
    createSession,
    sendMessage,
    executeSkill,
    cancelExecution,
    listSkills,
    listSessions,
    getSession,
    listTools,
    resolveHitl,
    listHistory,
  } = useAgentStream();

  const [input, setInput] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('DEV');
  const [showTools, setShowTools] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages]);

  const handleSend = useCallback(
    (text?: string) => {
      const msg = text ?? input;
      if (!msg.trim()) return;
      if (!session) {
        createSession(selectedAgent);
      } else {
        sendMessage(session.id, msg.trim());
      }
      setInput('');
      setMentionIndex(-1);
    },
    [input, session, selectedAgent, createSession, sendMessage],
  );

  const handleNewSession = useCallback(() => {
    createSession(selectedAgent);
  }, [selectedAgent, createSession]);

  const handleExecuteSkill = useCallback(
    (skillName: string) => {
      if (session) {
        executeSkill(session.id, skillName);
      }
    },
    [session, executeSkill],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);

    const atPos = val.lastIndexOf('@');
    if (atPos !== -1 && (atPos === 0 || val[atPos - 1] === ' ')) {
      const after = val.slice(atPos + 1);
      if (!after.includes(' ')) {
        setMentionQuery(after.toLowerCase());
        setMentionIndex(atPos);
        return;
      }
    }
    setMentionIndex(-1);
    setMentionQuery('');
  }, []);

  const insertMention = useCallback(
    (code: string) => {
      if (mentionIndex === -1) return;
      const before = input.slice(0, mentionIndex);
      const after = input.slice(mentionIndex).replace(/@\w*/, `@${code} `);
      setInput(before + after);
      setMentionIndex(-1);
      setMentionQuery('');
      inputRef.current?.focus();
    },
    [input, mentionIndex],
  );

  const filteredAgents = mentionQuery
    ? AGENTS.filter(
        (a) =>
          a.code.toLowerCase().includes(mentionQuery) ||
          a.name.toLowerCase().includes(mentionQuery),
      )
    : AGENTS;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mentionIndex !== -1 && filteredAgents.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          return;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          insertMention(filteredAgents[0].code);
          return;
        }
        if (e.key === 'Escape') {
          setMentionIndex(-1);
          setMentionQuery('');
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, mentionIndex, filteredAgents, insertMention],
  );

  const handleSuggestedAction = useCallback(
    (query: string, agent: string) => {
      setSelectedAgent(agent);
      if (session) {
        sendMessage(session.id, query);
      } else {
        createSession(agent);
      }
    },
    [session, createSession, sendMessage],
  );

  const sessionTitle = session
    ? `${session.agent} — ${session.messages.length} messages`
    : 'No active session';

  const lastMessage = session?.messages[session.messages.length - 1];
  const isStreaming = lastMessage?.streaming === true;

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <div className="flex-1 flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-3">
            <Bot className="w-5 h-5 text-purple-500" />
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Agent Chat</h2>
              <p className="text-xs text-gray-500">{sessionTitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs">
              {connected ? (
                <Wifi className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-red-500" />
              )}
              {connected ? 'Connected' : 'Disconnected'}
            </span>
            {bridgeConnected && (
              <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">
                MCP
              </span>
            )}
            <button
              onClick={handleNewSession}
              className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="New session"
            >
              <Plus className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50 dark:bg-gray-900/50">
          {!session && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Bot className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
              <h3 className="text-lg font-medium text-gray-500 dark:text-gray-400 mb-2">
                No active session
              </h3>
              <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
                Select an agent and start a conversation
              </p>
              <div className="flex gap-2 flex-wrap justify-center mb-6">
                {AGENTS.map((a) => (
                  <button
                    key={a.code}
                    onClick={() => setSelectedAgent(a.code)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      selectedAgent === a.code
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 ring-1 ring-purple-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {a.code}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 justify-center mb-6 max-w-md">
                {SUGGESTED_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => handleSuggestedAction(action.query, action.agent)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 hover:text-purple-700 dark:hover:text-purple-300 hover:ring-1 hover:ring-purple-300 transition-all"
                  >
                    <action.icon className="w-3.5 h-3.5" />
                    {action.label}
                  </button>
                ))}
              </div>

              <button
                onClick={handleNewSession}
                className="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm font-medium hover:bg-purple-600 transition-colors"
              >
                Start Session
              </button>
            </div>
          )}

          {session?.messages.map((msg) => (
            <AgentMessage key={msg.id} message={msg} onListItemClick={handleExecuteSkill} />
          ))}

          {session && session.messages.length === 0 && (
            <div className="flex flex-wrap gap-2 justify-center py-8">
              {SUGGESTED_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleSuggestedAction(action.query, selectedAgent)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 hover:text-purple-700 dark:hover:text-purple-300 hover:ring-1 hover:ring-purple-300 transition-all"
                >
                  <action.icon className="w-3.5 h-3.5" />
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {session?.status === 'active' && (
            <div className="flex items-center gap-2 text-sm text-gray-500 px-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Agent processing...
            </div>
          )}
          {session?.status === 'awaiting_input' && (
            <div className="flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400 px-2">
              <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
              Awaiting your input...
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
          <div className="flex items-center gap-2 relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={`Message @${selectedAgent}... (type @ to mention)`}
              className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={!connected}
            />
            <button
              onClick={() => session && listSkills(session.id)}
              disabled={!connected || !session}
              className="flex items-center gap-1 px-2 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="List available skills"
            >
              <Terminal className="w-4 h-4" />
              <span className="text-xs font-medium hidden sm:inline">Skills</span>
            </button>
            {isStreaming && (
              <button
                onClick={() => session && cancelExecution(session.id)}
                disabled={!connected}
                className="flex items-center gap-1 px-2 py-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                title="Cancel current execution"
              >
                <Square className="w-4 h-4" />
                <span className="text-xs font-medium hidden sm:inline">Cancel</span>
              </button>
            )}
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || !connected}
              className="p-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>

            {mentionIndex !== -1 && filteredAgents.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-10">
                {filteredAgents.map((a) => (
                  <button
                    key={a.code}
                    onClick={() => insertMention(a.code)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                  >
                    <span className="font-mono font-medium text-purple-600 dark:text-purple-400">
                      @{a.code}
                    </span>
                    <span className="text-gray-400">{a.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="w-72 flex flex-col gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
          <button
            onClick={() => {
              listSessions();
              setShowSessions(!showSessions);
            }}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            <MessageSquare className="w-4 h-4" />
            Sessions
          </button>
          {showSessions && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {agentSessions.length === 0 && <p className="text-xs text-gray-400">No sessions</p>}
              {agentSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => getSession(s.id)}
                  className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <span className="font-medium">{s.agent}</span>
                  <span className="text-gray-400 ml-1">({s.status})</span>
                  <span className="text-gray-400 block text-[10px]">{s.messageCount} messages</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
          <button
            onClick={() => {
              listTools();
              setShowTools(!showTools);
            }}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            <Terminal className="w-4 h-4" />
            MCP Tools
          </button>
          {showTools && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {!bridgeConnected && <p className="text-xs text-yellow-600">Bridge offline</p>}
              {bridgeConnected && tools.length === 0 && (
                <p className="text-xs text-gray-400">No tools</p>
              )}
              {tools.map((t) => (
                <button
                  key={t.name}
                  onClick={() => handleExecuteSkill(t.name)}
                  className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title={t.description}
                >
                  <code className="text-purple-600 dark:text-purple-400">{t.name}</code>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
          <button
            onClick={() => {
              listHistory();
              setShowHistory(!showHistory);
            }}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            <History className="w-4 h-4" />
            History
          </button>
          {showHistory && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {historySessions.length === 0 && <p className="text-xs text-gray-400">No history</p>}
              {historySessions.map((s: AgentSession) => (
                <button
                  key={s.id}
                  onClick={() => getSession(s.id)}
                  className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <span className="font-medium">{s.agent}</span>
                  <span className="text-gray-400 ml-1">({s.status})</span>
                  <span className="text-gray-400 block text-[10px]">{s.messages.length} msgs</span>
                  <span className="text-gray-400 block text-[10px]">
                    {new Date(s.updatedAt).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <HitlModal
        request={hitlRequest}
        onResolve={(response) => resolveHitl(response)}
        onDismiss={() => {
          /* Modal stays until resolved */
        }}
      />
    </div>
  );
}
