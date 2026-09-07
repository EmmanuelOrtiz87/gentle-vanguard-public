import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Prevent a single lazy route/render failure from white-screening the dashboard. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the crash observable without making the fallback depend on i18n or the API.
    // eslint-disable-next-line no-console
    console.error('[Dashboard] UI render error captured by ErrorBoundary', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-6">
        <div className="max-w-lg text-center">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Dashboard error
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
            This view failed to render. Reload the dashboard to recover.
          </p>
          <button
            type="button"
            onClick={() => globalThis.location.reload()}
            className="px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            Reload dashboard
          </button>
        </div>
      </div>
    );
  }
}
