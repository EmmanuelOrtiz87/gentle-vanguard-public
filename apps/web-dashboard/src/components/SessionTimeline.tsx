import { useState } from 'react';
import {
  Clock,
  ChevronDown,
  ChevronRight,
  Circle,
  Zap,
  GitBranch,
  Users,
  Activity,
  Shield,
} from 'lucide-react';

interface TimelineEvent {
  timestamp: string;
  event: string;
  execution_id?: string;
  payload?: string;
  status: string;
}

interface SessionTimelineProps {
  events: TimelineEvent[];
}

const eventIcons: Record<string, typeof Zap> = {
  'dispatch.started': Zap,
  'dispatch.completed': Zap,
  'agent.dispatched': Users,
  'agent.completed': Users,
  'session.started': Activity,
  'session.ended': Activity,
  'workflow.checkpoint': GitBranch,
  'workflow.publish': GitBranch,
  'validation.started': Shield,
  'validation.completed': Shield,
};

const eventColors: Record<string, string> = {
  'dispatch.started': 'text-blue-500',
  'dispatch.completed': 'text-green-500',
  'agent.dispatched': 'text-purple-500',
  'agent.completed': 'text-green-500',
  'session.started': 'text-yellow-500',
  'session.ended': 'text-gray-500',
  'workflow.checkpoint': 'text-cyan-500',
  'workflow.publish': 'text-emerald-500',
  'validation.started': 'text-orange-500',
  'validation.completed': 'text-green-500',
};

const eventLabels: Record<string, string> = {
  'dispatch.started': 'Dispatch Started',
  'dispatch.completed': 'Dispatch Completed',
  'agent.dispatched': 'Agent Dispatched',
  'agent.completed': 'Agent Completed',
  'session.started': 'Session Started',
  'session.ended': 'Session Ended',
  'workflow.checkpoint': 'Checkpoint',
  'workflow.publish': 'Publish',
  'validation.started': 'Validation Started',
  'validation.completed': 'Validation Completed',
};

export default function SessionTimeline({ events }: SessionTimelineProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 dark:text-gray-500">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No events yet</p>
        <p className="text-xs mt-1">
          Events appear when agent activities, sessions, or workflows are triggered
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {events.map((evt, i) => {
        const Icon = eventIcons[evt.event] || Circle;
        const color = eventColors[evt.event] || 'text-gray-400';
        const label = eventLabels[evt.event] || evt.event;
        const isLast = i === events.length - 1;
        const isExpanded = expanded === `${i}`;

        let payloadPreview = '';
        let payloadObj: Record<string, unknown> | null = null;
        if (evt.payload) {
          try {
            payloadObj = JSON.parse(evt.payload);
            payloadPreview = JSON.stringify(payloadObj, null, 2).slice(0, 200);
          } catch {
            payloadPreview = evt.payload.slice(0, 200);
          }
        }

        return (
          <div key={`${evt.timestamp}-${i}`} className="flex gap-2 sm:gap-4">
            <div className="flex flex-col items-center">
              <div
                className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center bg-white dark:bg-gray-800 border-2 ${color.replace('text', 'border')} ${color}`}
              >
                <Icon className="w-3 h-3 sm:w-4 sm:h-4" />
              </div>
              {!isLast && <div className="w-0.5 flex-1 bg-gray-200 dark:bg-gray-700" />}
            </div>
            <div className={`flex-1 min-w-0 pb-6 ${isLast ? 'pb-0' : ''}`}>
              <button
                onClick={() => setExpanded(isExpanded ? null : `${i}`)}
                className="flex items-start sm:items-center gap-1 sm:gap-2 w-full text-left"
              >
                <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">
                  {label}
                </span>
                <span className={`text-[10px] font-mono whitespace-nowrap ${color}`}>
                  {evt.status}
                </span>
                <span className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                  {payloadObj &&
                    (isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-gray-400" />
                    ))}
                </span>
              </button>
              {evt.execution_id && (
                <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                  exec: {evt.execution_id}
                </p>
              )}
              {isExpanded && payloadObj && (
                <pre className="mt-2 text-[10px] font-mono bg-gray-50 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 overflow-x-auto">
                  {payloadPreview}
                </pre>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
