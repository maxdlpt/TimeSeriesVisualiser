import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div style={{ padding: 32, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <strong style={{ fontSize: 16 }}>Render error — check DevTools console for the full stack trace.</strong>
        {'\n\n'}
        <code style={{ color: 'crimson' }}>{error.message}</code>
        {'\n\n'}
        <code style={{ fontSize: 12, opacity: 0.6 }}>{error.stack}</code>
      </div>
    )
  }
}
