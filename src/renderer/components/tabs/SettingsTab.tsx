import { useState } from 'react'
import { AlertCircle, CheckCircle, FolderOpen, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useAppStore } from '../../store/app'
import { useDBStore } from '../../store/db'
import { PALETTES, generateComplement } from '../../lib/colors'
import { isDarkTheme } from '../../lib/theme'
import { ipc } from '../../lib/ipc'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'

type Theme = 'light' | 'dark' | 'system'
const THEMES: readonly Theme[] = ['light', 'dark', 'system']

// Default colors for a brand-new palette: evenly-spread hues, vivid.
const NEW_PALETTE_DEFAULTS = [
  '#e11d48', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
]

// Derive a display name from the selected path: strip directory + ".db" suffix.
function deriveDBName(path: string): string {
  const basename = path.split(/[\\/]/).pop() ?? ''
  return basename.replace(/\.db$/i, '') || 'external'
}

// ─── Inline palette editor ─────────────────────────────────────────────────────

interface EditorState {
  /** null = creating new; string = name of palette being edited */
  originalName: string | null
  name: string
  colors: string[]
  /** true when the editor was opened in dark mode — colors[] are the dark variant */
  isDark: boolean
}

interface PaletteEditorProps {
  editor: EditorState
  existingNames: string[]
  onChange: (e: EditorState) => void
  onSave: () => void
  onCancel: () => void
}

function PaletteEditor({ editor, existingNames, onChange, onSave, onCancel }: PaletteEditorProps) {
  const { isDark } = editor
  const trimmedName = editor.name.trim()

  // Collides with a built-in or another custom palette (excluding the one being renamed)
  const isBuiltIn = Object.keys(PALETTES).includes(trimmedName.toLowerCase())
  const isDuplicate =
    trimmedName !== editor.originalName &&
    existingNames.some((n) => n === trimmedName)
  const isInvalid = trimmedName === '' || isBuiltIn || isDuplicate

  function setColor(i: number, hex: string) {
    const next = [...editor.colors]
    next[i] = hex
    onChange({ ...editor, colors: next })
  }

  function addColor() {
    onChange({ ...editor, colors: [...editor.colors, '#6366f1'] })
  }

  function removeColor(i: number) {
    onChange({ ...editor, colors: editor.colors.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="palette-name">
          Name
        </label>
        <Input
          id="palette-name"
          placeholder="e.g. Ocean"
          value={editor.name}
          onChange={(e) => onChange({ ...editor, name: e.target.value })}
          className={cn(isBuiltIn || isDuplicate ? 'border-destructive' : '')}
        />
        {isBuiltIn && (
          <p className="text-xs text-destructive">This name conflicts with a built-in palette.</p>
        )}
        {isDuplicate && (
          <p className="text-xs text-destructive">A custom palette with this name already exists.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          {isDark ? 'Dark colours' : 'Light colours'}{' '}
          <span className="font-normal text-muted-foreground/60">({editor.colors.length})</span>
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          {editor.colors.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered index within editor session
            <div key={i} className="relative group/swatch">
              <label
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full ring-2 ring-offset-2 ring-border hover:ring-foreground/60 transition-all"
                style={{ backgroundColor: c }}
                title={c}
              >
                <input
                  type="color"
                  value={c}
                  onChange={(e) => setColor(i, e.target.value)}
                  className="sr-only"
                />
              </label>
              {editor.colors.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeColor(i)}
                  className="absolute -top-1 -right-1 hidden group-hover/swatch:flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                  aria-label="Remove colour"
                >
                  <X className="h-2 w-2" />
                </button>
              )}
            </div>
          ))}
          {editor.colors.length < 12 && (
            <button
              type="button"
              onClick={addColor}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors"
              aria-label="Add colour"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Auto-generated complement preview — read-only */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          {isDark ? 'Light preview' : 'Dark preview'}{' '}
          <span className="font-normal text-muted-foreground/60">auto-generated</span>
        </p>
        <div className={cn(
          'flex flex-wrap gap-2 items-center rounded-md px-3 py-2',
          isDark ? 'bg-gray-100' : 'bg-gray-900',
        )}>
          {generateComplement(editor.colors).map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable display index
            <span key={i} className="h-5 w-5 rounded-full" style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={isInvalid} onClick={onSave}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// ─── SettingsTab ───────────────────────────────────────────────────────────────

export function SettingsTab() {
  const { theme, setTheme, colorPalette, setColorPalette, customPalettes, addCustomPalette, updateCustomPalette, removeCustomPalette } = useAppStore()
  const { externalDBs, addExternalDB, removeExternalDB } = useDBStore()

  const [editor, setEditor] = useState<EditorState | null>(null)

  const isDark               = isDarkTheme(theme)
  const customPaletteEntries = Object.entries(customPalettes)

  function openNewEditor() {
    setEditor({ originalName: null, name: '', colors: [...NEW_PALETTE_DEFAULTS], isDark })
  }

  function openEditEditor(name: string, entry: { light: string[], dark: string[] }) {
    // Edit the variant that matches the current theme so what you see is what you get.
    setEditor({ originalName: name, name, colors: isDark ? [...entry.dark] : [...entry.light], isDark })
  }

  function handleSave() {
    if (!editor) return
    const name = editor.name.trim()
    if (editor.originalName === null) {
      addCustomPalette(name, editor.colors, editor.isDark)
      setColorPalette(name)
    } else {
      updateCustomPalette(editor.originalName, name, editor.colors, editor.isDark)
    }
    setEditor(null)
  }

  function handleDelete(name: string) {
    removeCustomPalette(name)
    if (editor?.originalName === name) setEditor(null)
  }

  // Task #23: unreachable DBs are added with reachable:false (self-heal model)
  async function handleBrowseForDB(): Promise<void> {
    const path = await ipc.dialog.openDB()
    if (!path) return
    const reachable = await ipc.external.checkPath(path)
    addExternalDB({ id: crypto.randomUUID(), name: deriveDBName(path), path, reachable })
    // useAutoSaveSettings picks up the externalDBs change and persists after debounce.
  }

  return (
    <div className="flex flex-col gap-10 p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Settings</h2>

      {/* ── Theme ─────────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Theme</h3>
        <div className="flex gap-2">
          {THEMES.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={`flex-1 rounded-lg border py-2 text-sm capitalize transition-colors ${
                theme === t
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      {/* ── Colour palettes ───────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Graph Palettes</h3>

        {/* Built-in */}
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(PALETTES).map(([key, lightColors]) => {
            const displayColors = (isDark ? generateComplement(lightColors) : lightColors).slice(0, 5)
            return (
            <button
              key={key}
              type="button"
              aria-label={`palette-${key}`}
              onClick={() => { setColorPalette(key); setEditor(null) }}
              className={`rounded-lg border p-3 text-left transition-colors ${
                colorPalette === key
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <p className="text-xs font-medium capitalize mb-2 text-gray-900 dark:text-gray-100">{key}</p>
              <div className="flex gap-1">
                {displayColors.map(c => (
                  <span key={c} className="h-4 w-4 rounded-full" style={{ backgroundColor: c }} />
                ))}
              </div>
            </button>
            )
          })}
        </div>

        {/* Custom palettes */}
        {customPaletteEntries.length > 0 && (
          <>
            <p className="text-xs font-medium text-muted-foreground/60 pt-1">Custom</p>
            <div className="grid grid-cols-2 gap-2">
              {customPaletteEntries.map(([name, entry]) => {
                const displayColors = (isDark ? entry.dark : entry.light).slice(0, 5)
                return (
                  <div key={name} className="relative group/card">
                    <button
                      type="button"
                      aria-label={`palette-${name}`}
                      onClick={() => { setColorPalette(name); setEditor(null) }}
                      className={cn(
                        'w-full rounded-lg border p-3 text-left transition-colors pr-14',
                        colorPalette === name
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800',
                      )}
                    >
                      <p className="text-xs font-medium mb-2 text-gray-900 dark:text-gray-100 truncate">{name}</p>
                      <div className="flex gap-1 flex-wrap">
                        {displayColors.map((c, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: stable display order
                          <span key={i} className="h-4 w-4 rounded-full" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </button>
                    {/* Edit / delete — visible on hover */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                      <button
                        type="button"
                        aria-label={`Edit ${name}`}
                        onClick={() => openEditEditor(name, entry)}
                        className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${name}`}
                        onClick={() => handleDelete(name)}
                        className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Editor / New-palette button */}
        {editor ? (
          <PaletteEditor
            editor={editor}
            existingNames={Object.keys(customPalettes).filter(n => n !== editor.originalName)}
            onChange={setEditor}
            onSave={handleSave}
            onCancel={() => setEditor(null)}
          />
        ) : (
          <button
            type="button"
            onClick={openNewEditor}
            className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-4 w-4" />
            New palette
          </button>
        )}
      </section>

      <div className="border-t border-gray-200 dark:border-gray-800" />

      {/* ── External databases ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">External databases</h3>

        <div className="flex">
          <Button variant="outline" size="sm" onClick={handleBrowseForDB}>
            <FolderOpen className="h-4 w-4 mr-2" /> Browse for DB file
          </Button>
        </div>

        <div className="space-y-2">
          {externalDBs.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">No external databases configured.</p>
          )}
          {externalDBs.map(db => (
            <div
              key={db.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-800 p-3"
            >
              {db.reachable
                ? <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                : <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{db.name}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{db.path}</p>
                {!db.reachable && (
                  <p className="text-xs text-red-400 dark:text-red-400">
                    unreachable — re-checked on next startup
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label={`Remove ${db.name}`}
                onClick={() => removeExternalDB(db.id)}
                className="p-1 rounded text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
