import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TenantInfo } from '../types/tenant';

export function TenantSelector() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTenantId = searchParams.get('tenantId') || undefined;
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/tenants')
      .then((res) => res.json())
      .then((data) => {
        setTenants(data.tenants || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleChange = (tenantId: string | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (tenantId) next.set('tenantId', tenantId);
    else next.delete('tenantId');
    setSearchParams(next, { replace: true });
    setOpen(false);
  };

  const current = tenants.find((t) => t.id === currentTenantId);

  if (tenants.length <= 1) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${current ? 'bg-green-500' : 'bg-gray-400'}`} />
        {current ? current.name : 'Deployment tenant'}
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-50">
          <button
            onClick={() => handleChange(undefined)}
            className={`w-full text-left px-3 py-2 text-xs font-medium ${!currentTenantId ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'} hover:bg-gray-100 dark:hover:bg-gray-700`}
          >
            Deployment tenant
          </button>
          {tenants.map((t) => (
            <button
              key={t.id}
              onClick={() => handleChange(t.id)}
              className={`w-full text-left px-3 py-2 text-xs font-medium ${t.id === currentTenantId ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'} hover:bg-gray-100 dark:hover:bg-gray-700`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${t.isDefault ? 'bg-green-500' : 'bg-blue-400'}`}
                />
                {t.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
