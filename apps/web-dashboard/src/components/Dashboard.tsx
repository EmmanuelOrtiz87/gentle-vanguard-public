import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Coins,
  Users,
  Activity,
  Moon,
  Sun,
  RefreshCw,
  Server,
  Zap,
  Bot,
  Cpu,
  Clock,
  ThumbsUp,
  DollarSign,
  Shield,
  BarChart3,
  Gauge,
  TrendingUp,
  AlertTriangle,
  Info,
  Languages,
  Cloud,
} from 'lucide-react';
import { useMetrics } from '../hooks/useMetrics';
import { useAlerts } from '../hooks/useAlerts';
import { useSessions } from '../hooks/useSessions';
import { MetricsCard } from './MetricsCard';
import { LiveChart } from './LiveChart';
import { SessionTable } from './SessionTable';
import { AgentMessage } from './AgentMessage';
import { GlobalHealth } from './GlobalHealth';
import { useAgentStream } from '../hooks/useAgentStream';
import { NotificationToast } from './NotificationToast';
import { ValidationPanel } from './ValidationPanel';
import { SkillUsagePanel } from './SkillUsagePanel';
import { TokenUsagePanel } from './TokenUsagePanel';
import { ContractResultsPanel } from './ContractResultsPanel';
import { RoutingRulesPanel } from './RoutingRulesPanel';
import { SwarmWorkersPanel } from './SwarmWorkersPanel';
import { StackCapabilitiesPanel } from './StackCapabilitiesPanel';
import { AlertPanel } from './AlertPanel';
import { LiveTraceFeed } from './LiveTraceFeed';
import { SkillHeatmap } from './SkillHeatmap';
import { SessionActivityHeatmap } from './SessionActivityHeatmap';
import { ActivityTimeline } from './ActivityTimeline';
import { SloPanel } from './SloPanel';
import { InfoPopup } from './InfoPopup';
import { LocaleContext, useLocale, LOCALE_NAMES, LOCALE_FLAGS, t } from '../hooks/useLocale';
import { useStackTables } from '../hooks/useStackTables';
import type { Locale } from '../hooks/useLocale';
import type { ModelCost, CostInsight } from '../types/dashboard';

function SectionHeader({ title, infoKey }: { title: string; infoKey?: string }) {
  const { locale } = useLocale();
  const [showPopup, setShowPopup] = useState(false);
  const info = infoKey ? t(locale, infoKey) : undefined;

  return (
    <>
      <div className="flex items-center gap-2">
        {info && (
          <button
            onClick={() => setShowPopup(true)}
            className="p-0.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="More info"
          >
            <Info className="w-4 h-4" />
          </button>
        )}
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
      </div>
      {showPopup && info && <InfoPopup info={info} onClose={() => setShowPopup(false)} />}
    </>
  );
}

function OfflineBanner({ isOffline, lastUpdated }: { isOffline: boolean; lastUpdated: number }) {
  if (!isOffline) return null;

  const secondsAgo =
    lastUpdated > 0 ? Math.max(0, Math.round((Date.now() - lastUpdated) / 1000)) : null;
  const ageLabel = secondsAgo !== null ? `${secondsAgo}s` : 'unknown';

  return (
    <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-2">
        <Cloud className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Offline mode — showing cached data from {ageLabel} ago
        </p>
      </div>
    </div>
  );
}

function DashboardInner() {
  const [darkMode, setDarkMode] = useState(false);
  const [useWebSocket, setUseWebSocket] = useState(true);
  const [searchParams] = useSearchParams();
  const urlTenantId = searchParams.get('tenantId') || undefined;
  const {
    data,
    history,
    loading,
    wsConnected,
    refetch,
    notifications,
    dismissNotification,
    isOffline,
    lastUpdated,
  } = useMetrics(useWebSocket, urlTenantId);
  const { session: agentSession, bridgeConnected, createSession } = useAgentStream();
  const { triggeredAlerts } = useAlerts();
  const sessions = useSessions();
  const { locale, setLocale } = useLocale();
  const {
    skillUsage,
    tokenUsage,
    contractResults,
    routingRules,
    loading: stackLoading,
  } = useStackTables();
  const [showLangSelector, setShowLangSelector] = useState(false);

  useEffect(() => {
    if (bridgeConnected && !agentSession) {
      createSession('DEV');
    }
  }, [bridgeConnected]);

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle('dark');
  };

  const globalHealthData = data.globalHealth;
  const mcpData = data.mcp;
  const totalSkills = mcpData?.skills?.total || 0;
  const totalCalls = mcpData?.calls?.total || 0;
  const avgResponseTime = mcpData?.performance?.avgResponseTime || 0;
  const recentMessages = agentSession?.messages.slice(-5) || [];
  const topModel = data.tokens.byModel?.length
    ? data.tokens.byModel.reduce((a: ModelCost, b: ModelCost) => (a.cost > b.cost ? a : b))
    : null;

  const locales: Locale[] = ['en', 'es', 'pt-BR'];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                Gentle Vanguard Dashboard
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Real-time metrics and monitoring
                {wsConnected && <span className="ml-2 text-green-500">● WS Connected</span>}
                {!wsConnected && useWebSocket && (
                  <span className="ml-2 text-yellow-500">● WS Reconnecting...</span>
                )}
                {triggeredAlerts.length > 0 && (
                  <span className="ml-2 text-red-500 font-semibold">
                    ● {triggeredAlerts.length} alert(s)
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  onClick={() => setShowLangSelector(!showLangSelector)}
                  className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  title="Language / Idioma / Idioma"
                >
                  <Languages className="w-5 h-5" />
                </button>
                {showLangSelector && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowLangSelector(false)}
                    />
                    <div className="absolute right-0 mt-2 z-20 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 min-w-[180px]">
                      {locales.map((l) => (
                        <button
                          key={l}
                          onClick={() => {
                            setLocale(l);
                            setShowLangSelector(false);
                          }}
                          className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors ${
                            locale === l
                              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                        >
                          <span>{LOCALE_FLAGS[l]}</span>
                          <span>{LOCALE_NAMES[l]}</span>
                          {locale === l && <span className="ml-auto text-xs">✓</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => setUseWebSocket(!useWebSocket)}
                className={`p-2 rounded-lg transition-colors ${
                  useWebSocket
                    ? 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                }`}
                title={useWebSocket ? 'WebSocket Mode' : 'HTTP Polling Mode'}
              >
                {useWebSocket ? <Zap className="w-5 h-5" /> : <Server className="w-5 h-5" />}
              </button>
              <button
                onClick={refetch}
                disabled={loading}
                className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={toggleDarkMode}
                className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      <OfflineBanner isOffline={isOffline} lastUpdated={lastUpdated} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Row 1: Core KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {loading ? (
            <>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="card animate-pulse">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-3" />
                  <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-16 mb-2" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-32" />
                </div>
              ))}
            </>
          ) : (
            <>
              <MetricsCard
                title="Tokens Used"
                value={data.tokens.used.toLocaleString()}
                subtitle={`of ${data.tokens.limit.toLocaleString()} (${((data.tokens.used / data.tokens.limit) * 100).toFixed(1)}%)`}
                icon={Coins}
                color="blue"
                infoKey="tokens_used"
              />
              <MetricsCard
                title="Active Sessions"
                value={data.sessions.active}
                subtitle={`${data.sessions.today} today, ${data.sessions.total} total · ${data.sessions.avgDuration.toFixed(0)}s avg`}
                icon={Users}
                color="green"
                infoKey="active_sessions"
              />
              <MetricsCard
                title="Latency (avg)"
                value={data.latency ? `${data.latency.avg.toLocaleString()}ms` : 'N/A'}
                subtitle={
                  data.latency
                    ? `p95: ${data.latency.p95.toLocaleString()}ms · ${data.latency.samples} samples`
                    : ''
                }
                icon={Clock}
                color="yellow"
                infoKey="latency"
              />
              <MetricsCard
                title="Health Status"
                value={data.health.status}
                subtitle={`Routing: ${(data.health.routing * 100).toFixed(0)}%`}
                icon={Activity}
                color={data.health.status === 'healthy' ? 'green' : 'red'}
                infoKey="health"
              />
            </>
          )}
        </div>

        {/* Row 1b: Performance SLO */}
        <SloPanel />

        {/* Row 2: Cost, Feedback, SLA, System */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <MetricsCard
            title="Total Cost"
            value={`$${data.tokens.cost.toFixed(4)}`}
            subtitle={`Top model: ${topModel ? topModel.model : 'N/A'}`}
            icon={DollarSign}
            color="purple"
            infoKey="total_cost"
          />
          <MetricsCard
            title="Feedback Score"
            value={data.feedback ? `${data.feedback.score}%` : 'N/A'}
            subtitle={
              data.feedback ? `${data.feedback.thumbsUp}↑ ${data.feedback.thumbsDown}↓` : ''
            }
            icon={ThumbsUp}
            color={data.feedback && data.feedback.score >= 80 ? 'green' : 'yellow'}
            infoKey="feedback"
          />
          <MetricsCard
            title="SLA Compliance"
            value={data.sla ? `${data.sla.sloCompliance}%` : 'N/A'}
            subtitle={`Uptime: ${data.sla ? data.sla.uptime.toFixed(1) : 'N/A'}%`}
            icon={Shield}
            color={data.sla && data.sla.sloCompliance >= 99 ? 'green' : 'red'}
            infoKey="sla"
          />
          {data.system && (
            <MetricsCard
              title="System"
              value={`${data.system.uptime}s`}
              subtitle={`CPU ${data.system.cpu.user}ms · ${data.system.memory.rss}MB RSS`}
              icon={Cpu}
              color="purple"
              infoKey="system"
            />
          )}
        </div>

        {/* Row 3: Alerts */}
        <AlertPanel alerts={triggeredAlerts} />

        {/* Row 4: Cost by Model */}
        {data.tokens.byModel && data.tokens.byModel.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-gray-500" />
              <SectionHeader title="Cost by Model" infoKey="cost_by_model" />
            </div>
            <div className="card">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                        Model
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                        Input Tokens
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                        Output Tokens
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                        Total Tokens
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                        Cost
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                        %
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tokens.byModel.map((m: ModelCost) => (
                      <tr
                        key={m.model}
                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <td className="py-3 px-4 text-sm font-medium text-gray-900 dark:text-white">
                          {m.model}
                        </td>
                        <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400">
                          {m.inputTokens.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400">
                          {m.outputTokens.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400">
                          {m.totalTokens.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400">
                          ${m.cost.toFixed(4)}
                        </td>
                        <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400">
                          {data.tokens.cost > 0
                            ? ((m.cost / data.tokens.cost) * 100).toFixed(1)
                            : '0'}
                          %
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Row 5: Cost Insights */}
        {data.costInsights && data.costInsights.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-gray-500" />
              <SectionHeader title="Cost Optimization Insights" infoKey="cost_insights" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.costInsights
                .filter((ci: CostInsight) => ci.pct > 5)
                .map((ci: CostInsight) => (
                  <div key={ci.model} className="card">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="metric-label">{ci.model}</p>
                        <p className="metric-value mt-1">${ci.cost.toFixed(4)}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {ci.tokens.toLocaleString()} tokens ({ci.pct}%)
                        </p>
                      </div>
                      <div
                        className={`p-2 rounded-lg ${ci.pct > 30 ? 'bg-red-50 text-red-500' : 'bg-yellow-50 text-yellow-500'}`}
                      >
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                    </div>
                    {ci.suggestedAction && (
                      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-2 rounded">
                        💡 {ci.suggestedAction}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Row 6: Latency Detail */}
        {data.latency && data.latency.samples > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Gauge className="w-5 h-5 text-gray-500" />
              <SectionHeader title="Latency Percentiles" infoKey="latency_percentiles" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {['avg', 'p50', 'p95', 'p99', 'max'].map((p) => {
                const latency = data.latency;
                const val = (latency?.[p as keyof typeof latency] as number) ?? 0;
                const pct = (latency?.max ?? 0) > 0 ? (val / (latency?.max ?? 1)) * 100 : 0;
                return (
                  <div key={p} className="card text-center">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {p}
                    </p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white mt-1">
                      {val.toLocaleString()}ms
                    </p>
                    <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Row 7: SLA Detail */}
        {data.sla && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-gray-500" />
              <SectionHeader title="SLA & Reliability" infoKey="sla_reliability" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="card">
                <p className="metric-label">Uptime</p>
                <p className="metric-value">{data.sla.uptime.toFixed(2)}%</p>
                <div className="mt-2 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500"
                    style={{ width: `${data.sla.uptime}%` }}
                  />
                </div>
              </div>
              <div className="card">
                <p className="metric-label">SLO Compliance</p>
                <p className="metric-value">{data.sla.sloCompliance}%</p>
                <p className="text-xs text-gray-500 mt-1">Target: 99.9%</p>
              </div>
              <div className="card">
                <p className="metric-label">Incidents</p>
                <p className="metric-value">{data.sla.incidents}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {data.sla.lastIncident
                    ? `Last: ${new Date(data.sla.lastIncident).toLocaleDateString()}`
                    : 'No recent incidents'}
                </p>
              </div>
            </div>
          </div>
        )}

        {mcpData && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <SectionHeader title="MCP Server Metrics" infoKey="mcp" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="card">
                <p className="metric-label">Total Skills</p>
                <p className="metric-value">{totalSkills.toLocaleString()}</p>
              </div>
              <div className="card">
                <p className="metric-label">Total Calls</p>
                <p className="metric-value">{totalCalls.toLocaleString()}</p>
              </div>
              <div className="card">
                <p className="metric-label">Avg Response</p>
                <p className="metric-value">{avgResponseTime.toFixed(0)}ms</p>
              </div>
            </div>
          </div>
        )}

        {/* Skill Activity + Session Activity Heatmaps */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <SkillHeatmap
            bySkill={(data as any).mcp?.calls?.bySkill ?? {}}
            totalSkills={(data as any).mcp?.skills?.total ?? 0}
            totalCalls={(data as any).mcp?.calls?.total ?? 0}
          />
          <SessionActivityHeatmap sessions={sessions} />
        </div>

        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Cloud className="w-5 h-5 text-blue-500" />
            <SectionHeader title="Cloud Connectors" infoKey="mcp" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="card">
              <p className="metric-label">Cloud Executions</p>
              <p className="metric-value">{(data as any).cloud?.executions ?? 0}</p>
            </div>
            <div className="card">
              <p className="metric-label">Total Cost</p>
              <p className="metric-value">${((data as any).cloud?.totalCost ?? 0).toFixed(4)}</p>
            </div>
            <div className="card">
              <p className="metric-label">Checkpoints</p>
              <p className="metric-value">{(data as any).checkpoints ?? 0}</p>
            </div>
            <div className="card">
              <p className="metric-label">Audit Logs</p>
              <p className="metric-value">{(data as any).auditLogs ?? 0}</p>
            </div>
          </div>
        </div>

        {/* Row: Swarm Workers */}
        <div className="mb-8">
          <SwarmWorkersPanel data={data.swarmWorkers} />
        </div>

        {/* Row: Stack Capabilities (Fase 1/2: anomalies, circuit breakers, DB healing) */}
        <div className="mb-8">
          <StackCapabilitiesPanel data={(data as any).stackCapabilities} />
        </div>

        {/* Row: SQLite Stack Tables (Wave 37) */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-5 h-5 text-teal-500" />
            <SectionHeader title="SQLite Stack Tables" infoKey="mcp" />
            {stackLoading && <RefreshCw className="w-3.5 h-3.5 text-gray-400 animate-spin" />}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SkillUsagePanel skills={skillUsage.skills} total={skillUsage.total} />
            <TokenUsagePanel usage={tokenUsage.usage} total={tokenUsage.total} />
            <ContractResultsPanel results={contractResults.results} total={contractResults.total} />
            <RoutingRulesPanel rules={routingRules.rules} total={routingRules.total} />
          </div>
        </div>

        {/* Row: Session & Repository Activity */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-purple-500" />
            <SectionHeader title="Session & Repository Activity" infoKey="active_sessions" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card">
              <p className="metric-label">Total Sessions</p>
              <p className="metric-value text-purple-600 dark:text-purple-400">
                {data.sessions.total}
              </p>
              <p className="text-xs text-gray-500 mt-1">{data.sessions.active} active now</p>
            </div>
            <div className="card">
              <p className="metric-label">Git Commits</p>
              <p className="metric-value text-blue-600 dark:text-blue-400">
                {(data as any).git?.commits ?? 0}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {(data as any).git?.contributors ?? 0} contributors
              </p>
            </div>
            <div className="card">
              <p className="metric-label">Trace Files</p>
              <p className="metric-value text-amber-600 dark:text-amber-400">
                {(data as any).traceFiles ?? 0}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {(data as any).checkpoints ?? 0} checkpoints
              </p>
            </div>
            <div className="card">
              <p className="metric-label">Audit Logs</p>
              <p className="metric-value text-emerald-600 dark:text-emerald-400">
                {(data as any).auditLogs ?? 0}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {(data as any).mcp?.skills?.total ?? 0} MCP skills
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <ValidationPanel />
          <LiveTraceFeed />
        </div>

        {globalHealthData && (
          <div className="mb-8">
            <GlobalHealth data={globalHealthData} />
          </div>
        )}

        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <SectionHeader title="Agent Activity" infoKey="agent_activity" />
            </div>
            <span className="flex items-center gap-1 text-xs text-gray-500">
              {bridgeConnected ? (
                <Bot className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <Bot className="w-3.5 h-3.5 text-gray-400" />
              )}
              {bridgeConnected ? 'Bridge Online' : 'Bridge Offline'}
            </span>
          </div>
          <div className="card">
            {recentMessages.length === 0 && (
              <div className="text-center py-6 text-gray-400 dark:text-gray-500">
                <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No agent activity yet</p>
                <button
                  onClick={() => createSession('DEV')}
                  className="mt-2 text-xs text-purple-500 hover:text-purple-600 underline"
                >
                  Start a session
                </button>
              </div>
            )}
            {recentMessages.length > 0 && (
              <div className="space-y-3">
                {recentMessages.map((msg: any) => (
                  <AgentMessage key={msg.id} message={msg} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <LiveChart data={history} />
          <ActivityTimeline history={history} />
        </div>

        <SessionTable sessions={sessions} />
      </main>
      <NotificationToast notifications={notifications} onClose={dismissNotification} />
    </div>
  );
}

export default function Dashboard() {
  const [locale, setLocale] = useState<Locale>('en');

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <DashboardInner />
    </LocaleContext.Provider>
  );
}
