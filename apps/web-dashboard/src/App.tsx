import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Activity,
  Store,
  BookOpen,
  Bot,
  ListTodo,
  History,
  Menu,
  X,
  Cpu,
  Library,
  Globe,
  Workflow,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import { useSharedState } from './hooks/useSharedState';
import { TenantSelector } from './components/TenantSelector';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useT } from './hooks/useLocale';

const Dashboard = lazy(() => import('./components/Dashboard'));
const TracingDashboard = lazy(() => import('./components/TracingDashboard'));
const Marketplace = lazy(() => import('./components/Marketplace'));
const InteractiveDocs = lazy(() => import('./components/InteractiveDocs'));
const AgentChat = lazy(() => import('./components/AgentChat'));
const TaskControl = lazy(() => import('./components/TaskControl'));
const SessionTimeline = lazy(() => import('./components/SessionTimeline'));
const MCPServers = lazy(() => import('./components/MCPServers'));
const KnowledgePanel = lazy(() => import('./components/KnowledgePanel'));
const MultiRepoView = lazy(() => import('./components/MultiRepoView'));
const ContentOpsPanel = lazy(() => import('./components/ContentOpsPanel'));
const AuditPanel = lazy(() => import('./components/AuditPanel'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
  </div>
);

function Navigation() {
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/tracing', icon: Activity, label: 'Tracing' },
    { to: '/marketplace', icon: Store, label: 'Marketplace' },
    { to: '/content-operations', icon: Workflow, label: 'Content Ops' },
    { to: '/audit', icon: ShieldCheck, label: 'Audit' },
    { to: '/admin', icon: UserCog, label: 'Admin' },
    { to: '/agents', icon: Bot, label: 'Agents' },
    { to: '/tasks', icon: ListTodo, label: 'Tasks' },
    { to: '/timeline', icon: History, label: 'Timeline' },
    { to: '/docs', icon: BookOpen, label: 'Docs' },
    { to: '/mcp', icon: Cpu, label: 'MCP' },
    { to: '/knowledge', icon: Library, label: 'Knowledge' },
    { to: '/multi-repo', icon: Globe, label: 'Multi-repo' },
  ];

  return (
    <nav className="gv-topbar">
      <div className="gv-topbar-inner">
        <div className="gv-brand-row">
          <div className="gv-brand-mark" aria-hidden="true">
            GV
          </div>
          <div className="gv-brand-copy">
            <span className="gv-brand-name">Gentle Vanguard</span>
            <span className="gv-brand-product">Stack operations</span>
          </div>
          <div className="gv-live-state">
            <span className="gv-live-dot" /> Local stack
          </div>
          <TenantSelector />
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="gv-menu-button lg:hidden"
            aria-label="Open navigation"
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
          <div className="gv-nav-links hidden lg:flex">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) => `gv-nav-link ${isActive ? 'is-active' : ''}`}
              >
                <l.icon className="w-4 h-4" />
                {l.label}
              </NavLink>
            ))}
          </div>
        </div>
        {menuOpen && (
          <div className="gv-mobile-nav lg:hidden">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => setMenuOpen(false)}
                end={l.to === '/'}
                className={({ isActive }) => `gv-nav-link ${isActive ? 'is-active' : ''}`}
              >
                <l.icon className="w-4 h-4" />
                {l.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

function TasksPage() {
  const { tt } = useT();
  const { tasks, connected, emitEvent } = useSharedState();
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Agent Tasks</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {tt('ui.tasks_page_subtitle')}
        </p>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <TaskControl tasks={tasks} connected={connected} onEmitEvent={emitEvent} />
      </div>
    </div>
  );
}

function TimelinePage() {
  const { tt } = useT();
  const { events, connected } = useSharedState();
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Event Timeline</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {tt('ui.timeline_page_subtitle')}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-500">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <SessionTimeline events={events} />
      </div>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<{
    checked: boolean;
    authenticated: boolean;
    warning?: string;
  }>({ checked: false, authenticated: false });
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const checkStatus = async () => {
    const response = await fetch('/api/auth/status');
    const body = await response.json();
    setStatus({ checked: true, authenticated: body.authenticated === true, warning: body.warning });
  };

  useEffect(() => {
    void checkStatus().catch(() => setStatus({ checked: true, authenticated: false }));
  }, []);

  if (!status.checked) return <PageLoader />;
  if (status.authenticated) return <>{children}</>;

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      setError('Invalid dashboard token');
      return;
    }
    setToken('');
    await checkStatus();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={(event) => void login(event)}
        className="w-full max-w-sm space-y-4 rounded-lg border p-6 shadow-sm"
      >
        <h1 className="text-xl font-semibold">Dashboard sign in</h1>
        {status.warning && <p className="text-sm text-amber-700">{status.warning}</p>}
        <input
          className="w-full rounded border p-2"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Dashboard token"
          autoComplete="current-password"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded bg-blue-600 p-2 text-white" type="submit">
          Sign in
        </button>
      </form>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AuthGate>
          <div className="gv-app-shell">
            <Navigation />
            <main className="gv-main">
              <div className="gv-route-frame">
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/tracing" element={<TracingDashboard />} />
                    <Route path="/marketplace" element={<Marketplace />} />
                    <Route path="/content-operations" element={<ContentOpsPanel />} />
                    <Route path="/audit" element={<AuditPanel />} />
                    <Route path="/admin" element={<AdminPanel />} />
                    <Route path="/docs" element={<InteractiveDocs />} />
                    <Route path="/agents" element={<AgentChat />} />
                    <Route path="/tasks" element={<TasksPage />} />
                    <Route path="/timeline" element={<TimelinePage />} />
                    <Route path="/mcp" element={<MCPServers />} />
                    <Route path="/knowledge" element={<KnowledgePanel />} />
                    <Route path="/multi-repo" element={<MultiRepoView />} />
                  </Routes>
                </Suspense>
              </div>
            </main>
          </div>
        </AuthGate>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
