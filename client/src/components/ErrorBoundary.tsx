import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches render errors in the app routes so a single component crash
 * doesn't white-screen the whole app (demo safety net). Shows a friendly
 * fallback instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[ErrorBoundary] component crash:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            maxWidth: 480,
            margin: '80px auto',
            padding: 20,
            textAlign: 'center',
            color: '#374151',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 8 }}>😵</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
            Something broke
          </div>
          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
            The page hit an unexpected error. Refresh to get back to the feed.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              background: '#111827',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
