import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { applyTheme, applyUiTheme } from './lib/theme'
import './styles/globals.css'

// Apply the last-known themes synchronously before React renders so the page
// never flashes on reload.  The IPC settings load is async; without this
// the app always starts in the default state for ~100 ms while waiting for SQLite.
// `useHydrateSettings` keeps these caches current after every settings load.
const cachedTheme = (localStorage.getItem('tsv-theme') ?? 'system') as 'light' | 'dark' | 'system'
applyTheme(cachedTheme)
const cachedUiTheme = localStorage.getItem('tsv-ui-theme') ?? 'original'
applyUiTheme(cachedUiTheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
