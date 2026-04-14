import { useState } from 'react'
import { Save, Database } from 'lucide-react'
import { useGraphStore } from '../../store/graph'
import { ipc } from '../../lib/ipc'
import { Button } from '../ui/button'

export function SaveMenu(): JSX.Element {
  const activeSeries = useGraphStore((s) => s.activeSeries)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const saveToMemory = async (): Promise<void> => {
    setSaving(true)
    for (const s of activeSeries) {
      await ipc.memory.saveSeries(s)
    }
    setSaving(false)
    setSaved('memory')
    setTimeout(() => setSaved(null), 2000)
  }

  const saveToExternalDB = async (): Promise<void> => {
    setSaving(true)
    const path = await ipc.dialog.openDB()
    if (path) {
      const ids = activeSeries.map((s) => s.id)
      await ipc.dialog.saveDB(path, ids)
      setSaved('external')
      setTimeout(() => setSaved(null), 2000)
    }
    setSaving(false)
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        className="w-full justify-start text-sm"
        onClick={saveToMemory}
        disabled={saving || activeSeries.length === 0}
      >
        <Save className="h-3.5 w-3.5 mr-2" />
        {saved === 'memory' ? '✓ Saved to Memory' : 'Save to App Memory'}
      </Button>
      <Button
        variant="outline"
        className="w-full justify-start text-sm"
        onClick={saveToExternalDB}
        disabled={saving || activeSeries.length === 0}
      >
        <Database className="h-3.5 w-3.5 mr-2" />
        {saved === 'external' ? '✓ Exported' : 'Export to .db File'}
      </Button>
    </div>
  )
}
