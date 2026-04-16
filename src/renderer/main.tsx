import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { applyTheme } from './lib/theme'
import './styles/globals.css'

// Apply the last-known theme synchronously before React renders so the page
// never flashes white on reload.  The IPC settings load is async; without this
// the app always starts in light mode for ~100 ms while waiting for SQLite.
// `useHydrateSettings` keeps this cache current after every settings load.
const cachedTheme = (localStorage.getItem('tsv-theme') ?? 'system') as 'light' | 'dark' | 'system'
applyTheme(cachedTheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
