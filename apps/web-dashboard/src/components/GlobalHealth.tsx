import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  GitBranch,
  GitPullRequest,
  ExternalLink,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Shield,
} from 'lucide-react';
import type { GlobalHealth as GlobalHealthType } from '../types/dashboard';
import { useT } from '../hooks/useLocale';

interface GlobalHealthProps {
  data: GlobalHealthType;
}

function useBannerConfig() {
  const { tt } = useT();
  return {
    healthy: {
      icon: Shield,
      color:
        'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300',
      label: tt('ui.all_systems_healthy'),
    },
    degraded: {
      icon: AlertTriangle,
      color:
        'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-300',
      label: tt('ui.systems_degraded'),
    },
    critical: {
      icon: XCircle,
      color:
        'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300',
      label: tt('ui.critical_issues'),
    },
  };
}

const statusBadgeColors: Record<string, string> = {
  healthy: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  degraded: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  down: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const ciBadgeColors: Record<string, string> = {
  passing: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  failing: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  unknown: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function GlobalHealth({ data }: GlobalHealthProps) {
  const [expanded, setExpanded] = useState(false);
  const { tt } = useT();
  const statusBannerConfig = useBannerConfig();
  const banner = statusBannerConfig[data.overallStatus];
  const BannerIcon = banner.icon;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{tt('ui.global_health')}</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <RefreshCw className="w-3 h-3" />
            {tt('ui.updated')} {timeAgo(data.lastUpdated)}
          </span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            )}
          </button>
        </div>
      </div>

      <div className={`border rounded-lg p-4 mb-4 ${banner.color}`}>
        <div className="flex items-center gap-3">
          <BannerIcon className="w-6 h-6" />
          <div>
            <p className="font-semibold">{banner.label}</p>
            <p className="text-sm opacity-80">
              {data.healthyRepos}/{data.totalRepos} {tt('ui.repositories_healthy')}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        <div className="text-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.totalRepos}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{tt('ui.total_repos')}</p>
        </div>
        <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {data.healthyRepos}
          </p>
          <p className="text-xs text-green-600 dark:text-green-400">{tt('ui.healthy')}</p>
        </div>
        <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
          <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
            {data.degradedRepos}
          </p>
          <p className="text-xs text-yellow-600 dark:text-yellow-400">{tt('ui.degraded_plural')}</p>
        </div>
        <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{data.criticalRepos}</p>
          <p className="text-xs text-red-600 dark:text-red-400">{tt('ui.critical_plural')}</p>
        </div>
        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{data.avgCoverage}%</p>
          <p className="text-xs text-blue-600 dark:text-blue-400">{tt('ui.avg_coverage')}</p>
        </div>
      </div>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-3 px-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                  {tt('ui.repository')}
                </th>
                <th className="text-left py-3 px-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                  {tt('ui.status')}
                </th>
                <th className="text-left py-3 px-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                  {tt('ui.last_commit')}
                </th>
                <th className="text-left py-3 px-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1">
                    <GitPullRequest className="w-3.5 h-3.5" />
                    PRs
                  </span>
                </th>
                <th className="text-left py-3 px-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                  CI
                </th>
                <th className="text-left py-3 px-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                  {tt('ui.coverage')}
                </th>
                <th className="text-left py-3 px-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                  {tt('ui.contributors')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.repositories.map((repo) => {
                const StatusIcon =
                  repo.status === 'healthy'
                    ? CheckCircle
                    : repo.status === 'degraded'
                      ? AlertTriangle
                      : XCircle;
                const CiIcon =
                  repo.ciStatus === 'passing'
                    ? CheckCircle
                    : repo.ciStatus === 'failing'
                      ? XCircle
                      : Activity;
                return (
                  <tr
                    key={repo.name}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <td className="py-3 px-3">
                      <a
                        href={`https://github.com/gentle-vanguard/${repo.name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        <GitBranch className="w-3.5 h-3.5" />
                        {repo.name}
                        <ExternalLink className="w-3 h-3 opacity-60" />
                      </a>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${statusBadgeColors[repo.status]}`}
                      >
                        <StatusIcon className="w-3 h-3" />
                        {tt(`ui.${repo.status}`)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-sm text-gray-600 dark:text-gray-400">
                      {timeAgo(repo.lastCommit)}
                    </td>
                    <td className="py-3 px-3 text-sm text-gray-600 dark:text-gray-400">
                      {repo.openPRs}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${ciBadgeColors[repo.ciStatus]}`}
                      >
                        <CiIcon className="w-3 h-3" />
                        {tt(`ui.${repo.ciStatus}`)}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              repo.coverage >= 80
                                ? 'bg-green-500'
                                : repo.coverage >= 60
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                            style={{ width: `${repo.coverage}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600 dark:text-gray-400 w-10 text-right">
                          {repo.coverage}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-sm text-gray-600 dark:text-gray-400">
                      {repo.contributors}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
