import { Suspense, lazy, useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
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
} from 'lucide-react';
import { useSharedState } from './hooks/useSharedState';
import { TenantSelector } from './components/TenantSelector';

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
    { to: '/agents', icon: Bot, label: 'Agents' },
    { to: '/tasks', icon: ListTodo, label: 'Tasks' },
    { to: '/timeline', icon: History, label: 'Timeline' },
    { to: '/docs', icon: BookOpen, label: 'Docs' },
    { to: '/mcp', icon: Cpu, label: 'MCP' },
    { to: '/knowledge', icon: Library, label: 'Knowledge' },
    { to: '/multi-repo', icon: Globe, label: 'Multi-repo' },
  ];

  return (
    <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-gray-900 dark:text-white">GV Dashboard</span>
            <TenantSelector />
          </div>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="lg:hidden p-2 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
          <div className="hidden lg:flex items-center space-x-1">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <l.icon className="w-4 h-4" />
                {l.label}
              </Link>
            ))}
          </div>
        </div>
        {menuOpen && (
          <div className="lg:hidden pb-3 space-y-1">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <l.icon className="w-4 h-4" />
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

function TasksPage() {
  const { tasks, connected, emitEvent } = useSharedState();
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Agent Tasks</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Monitor and control active agent tasks
        </p>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <TaskControl tasks={tasks} connected={connected} onEmitEvent={emitEvent} />
      </div>
    </div>
  );
}

function TimelinePage() {
  const { events, connected } = useSharedState();
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Event Timeline</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Real-time event history from the event bus
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

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Navigation />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tracing" element={<TracingDashboard />} />
            <Route path="/marketplace" element={<Marketplace />} />
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
    </BrowserRouter>
  );
}

export default App;
