/**
 * Synchronously resolve whether dark mode is currently active.
 * Mirrors `applyTheme` logic exactly so both agree on the effective state.
 */
export function isDarkTheme(theme: 'light' | 'dark' | 'system'): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else if (theme === 'light') {
    root.classList.remove('dark')
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  }
}

export const UI_THEMES = [
  { id: 'original', label: 'Original' },
  { id: 'gold',     label: 'Gold' },
  { id: 'ocean',    label: 'Ocean' },
  { id: 'forest',   label: 'Forest' },
  { id: 'rose',     label: 'Rose' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'dracula',  label: 'Dracula' },
] as const

export type UiThemeId = typeof UI_THEMES[number]['id']

export function applyUiTheme(theme: string): void {
  const root = document.documentElement
  if (theme === 'original') {
    root.removeAttribute('data-ui-theme')
  } else {
    root.setAttribute('data-ui-theme', theme)
  }
}
