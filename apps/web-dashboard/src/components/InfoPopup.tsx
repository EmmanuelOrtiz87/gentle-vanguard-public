import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { MetricInfo } from '../hooks/useLocale';

interface InfoPopupProps {
  info: MetricInfo;
  onClose: () => void;
}

export function InfoPopup({ info, onClose }: InfoPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={popupRef}
          className="animate-fade-in bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-md w-full max-h-[80vh] overflow-y-auto"
        >
          <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-gray-700">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{info.label}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{info.description}</p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                What it measures
              </h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {info.what}
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                How it's calculated
              </h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{info.how}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
