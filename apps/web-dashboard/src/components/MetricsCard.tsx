import { useState } from 'react';
import { LucideIcon, Info } from 'lucide-react';
import { InfoPopup } from './InfoPopup';
import { useLocale, t } from '../hooks/useLocale';

interface MetricsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
  infoKey?: string;
}

const colorClasses = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
  green: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400',
  yellow: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400',
  red: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
  purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
};

export function MetricsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = 'blue',
  infoKey,
}: MetricsCardProps) {
  const [showPopup, setShowPopup] = useState(false);
  const { locale } = useLocale();
  const info = infoKey ? t(locale, infoKey) : undefined;

  return (
    <>
      <div className="card">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="metric-label">{title}</p>
              {info && (
                <button
                  onClick={() => setShowPopup(true)}
                  className="p-0.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex-shrink-0"
                  title="More info"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="metric-value mt-1">{value}</p>
            {subtitle && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 break-words">
                {subtitle}
              </p>
            )}
          </div>
          <div className={`p-3 rounded-lg flex-shrink-0 ml-3 ${colorClasses[color]}`}>
            <Icon className="w-6 h-6" />
          </div>
        </div>
      </div>
      {showPopup && info && <InfoPopup info={info} onClose={() => setShowPopup(false)} />}
    </>
  );
}
