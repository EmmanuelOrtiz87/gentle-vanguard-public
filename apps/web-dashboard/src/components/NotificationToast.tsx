import { X, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import type { Notification } from '../hooks/useMetrics';

const ICONS: Record<string, React.ReactNode> = {
  info: <Info className="w-4 h-4 text-blue-500" />,
  warning: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
  error: <AlertCircle className="w-4 h-4 text-red-500" />,
};

export function NotificationToast({
  notifications,
  onClose,
}: {
  notifications: Notification[];
  onClose: (i: number) => void;
}) {
  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
      {notifications.map((n, i) => (
        <div
          key={`${n.timestamp}-${i}`}
          className="flex items-start gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-lg animate-slide-up"
        >
          {ICONS[n.severity] || ICONS.info}
          <p className="text-sm text-gray-200 flex-1">{n.message}</p>
          <button onClick={() => onClose(i)} className="text-gray-500 hover:text-gray-300">
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
