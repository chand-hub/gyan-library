import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'An unexpected application error occurred.' };
  }

  render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed && parsed.error) {
          friendly = `Access or sync error (${parsed.operationType || 'read'} on ${parsed.path || 'record'}): ${parsed.error}`;
        }
      } catch {
        // Use plain message
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-slate-950 p-6">
          <div className="max-w-lg w-full bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 rounded-lg p-8 shadow-sm">
            <h2 className="font-display text-2xl font-bold text-primary dark:text-white mb-2">
              Unable to load workspace view
            </h2>
            <p className="text-sm text-on-surface-variant dark:text-slate-300 mb-6 break-words">
              {friendly}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="px-4 py-2 rounded bg-primary text-on-primary text-sm font-semibold hover:bg-primary-container transition-colors cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
