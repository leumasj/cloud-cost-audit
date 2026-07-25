import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log to console — Sentry will catch it via the API layer
    console.error('KloudAudit Error Boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', background: '#080810', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: '24px',
        }}>
          <div style={{
            maxWidth: '480px', textAlign: 'center',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px', padding: '40px', background: '#0f0f1a',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚡</div>
            <h2 style={{ color: '#fff', fontSize: '20px', marginBottom: '12px' }}>
              Something went wrong
            </h2>
            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>
              An unexpected error occurred. If you'd already started your audit, your progress has been saved and will be restored.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = '/';
              }}
              style={{
                background: '#00ffb4', color: '#000', border: 'none',
                borderRadius: '10px', padding: '12px 24px',
                fontSize: '14px', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Return to Homepage
            </button>
            <p style={{ color: '#334155', fontSize: '12px', marginTop: '16px' }}>
              Error has been logged. Email admin@kloudaudit.eu if this persists.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
