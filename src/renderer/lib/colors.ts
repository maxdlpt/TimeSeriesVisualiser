export const PALETTES: Record<string, string[]> = {
  default: ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'],
  pastel:  ['#93c5fd', '#fca5a5', '#86efac', '#fde68a', '#c4b5fd', '#67e8f9', '#fed7aa', '#f9a8d4'],
  muted:   ['#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#a78bfa', '#22d3ee', '#fb923c', '#f472b6'],
  mono:    ['#1d4ed8', '#1e40af', '#1e3a8a', '#172554', '#0f172a', '#334155', '#475569', '#64748b'],
}

export function getColor(palette: string, index: number): string {
  const colors = PALETTES[palette] ?? PALETTES.default
  return colors[index % colors.length]
}
