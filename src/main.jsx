import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'
import * as Sentry from '@sentry/react'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

// Client-side error tracking — mirrors api/lib/_sentry.js's graceful
// degradation: no-ops entirely if VITE_SENTRY_DSN isn't set, so this never
// blocks local dev or an unconfigured deploy. Sentry's default integrations
// hook window.onerror/unhandledrejection, which catches errors happening
// outside React's render cycle (event handlers, timers, async callbacks) —
// exactly what the ErrorBoundary below cannot see on its own.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  })
}

// Inject Vercel Analytics — free, zero config
inject()

// Inject Vercel Speed Insights — tracks Core Web Vitals
injectSpeedInsights()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
