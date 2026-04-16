import { useCallback, useState } from 'react'
import { Upload } from 'lucide-react'
import { useAppStore } from '../../store/app'
import { useGraphStore } from '../../store/graph'
import { getColor } from '../../lib/colors'
import { isDarkTheme } from '../../lib/theme'
import { FileDropZone } from '../upload/FileDropZone'
import { PasteTable } from '../upload/PasteTable'
import { SeriesReviewPanel } from '../upload/SeriesReviewPanel'
import { Selector } from '../ui/segment-group'
import type { DataSeries } from '../../../shared/types'

type Mode = 'file' | 'paste'

const TITLE_FONT_STYLE = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif",
}

function FileIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="-64 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <path d="M369.9 97.9L286 14C277 5 264.8-.1 252.1-.1H48C21.5 0 0 21.5 0 48v416c0 26.5 21.5 48 48 48h288c26.5 0 48-21.5 48-48V131.9c0-12.7-5.1-25-14.1-34zM332.1 128H256V51.9l76.1 76.1zM48 464V48h160v104c0 13.3 10.7 24 24 24h104v288H48zm212-240h-28.8c-4.4 0-8.4 2.4-10.5 6.3-18 33.1-22.2 42.4-28.6 57.7-13.9-29.1-6.9-17.3-28.6-57.7-2.1-3.9-6.2-6.3-10.6-6.3H124c-9.3 0-15 10-10.4 18l46.3 78-46.3 78c-4.7 8 1.1 18 10.4 18h28.9c4.4 0 8.4-2.4 10.5-6.3 21.7-40 23-45 28.6-57.7 14.9 30.2 5.9 15.9 28.6 57.7 2.1 3.9 6.2 6.3 10.6 6.3H260c9.3 0 15-10 10.4-18L224 320c.7-1.1 30.3-50.5 46.3-78 4.7-8-1.1-18-10.3-18z" />
    </svg>
  )
}

function PasteIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H9M15 5H17C18.1046 5 19 5.89543 19 7V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.902 20.3343L12.7153 20.7716L13.1526 18.585C13.1914 18.3914 13.2865 18.2136 13.4261 18.074L17.5 14L19.5 12L21.4869 13.9869L19.4869 15.9869L15.413 20.0608C15.2734 20.2004 15.0956 20.2956 14.902 20.3343Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5V7H9V5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Two-stage flow: the primitive emits parsed series into a local `pendingSeries`
// buffer (re-parse on every keystroke in PasteTable just overwrites the buffer,
// no store flood), then an explicit "Add to Graph" click commits to the graph
// store and navigates to the graph tab. Colors are assigned at buffer-in time
// so the Add-to-Graph preview accurately reflects what will be rendered.
export function UploadTab(): JSX.Element {
  const [mode, setMode] = useState<Mode>('file')
  const [pendingSeries, setPendingSeries] = useState<DataSeries[]>([])
  const colorPalette   = useAppStore((s) => s.colorPalette)
  const customPalettes = useAppStore((s) => s.customPalettes)
  const theme          = useAppStore((s) => s.theme)
  const activeSeriesCount = useGraphStore((s) => s.activeSeries.length)

  const handleSeries = useCallback(
    (series: DataSeries[]) => {
      const colored = series.map((s, i) => ({
        ...s,
        color: s.color ?? getColor(colorPalette, activeSeriesCount + i, customPalettes, isDarkTheme(theme)),
      }))
      setPendingSeries(colored)
    },
    [colorPalette, customPalettes, theme, activeSeriesCount],
  )

  const confirmSeries = useCallback((edited: DataSeries[]): void => {
    const { addSeries } = useGraphStore.getState()
    for (const s of edited) addSeries(s)
    useAppStore.getState().setActiveTab('graph')
    setPendingSeries([])
  }, [])

  const onModeChange = (next: Mode): void => {
    // Discard any mid-flight pending series — mixing file-drop output with
    // paste-table output is almost never what the user wants.
    setPendingSeries([])
    setMode(next)
  }

  return (
    <div className="flex flex-col h-full w-full p-8 gap-6">
      <div className="flex items-center gap-3 leading-none select-none text-foreground" style={TITLE_FONT_STYLE}>
        <Upload className="h-8 w-8 text-blue-500 shrink-0" />
        <h2 className="text-4xl font-black leading-none">Upload Series</h2>
      </div>

      {pendingSeries.length > 0 ? (
        <SeriesReviewPanel
          series={pendingSeries}
          onConfirm={confirmSeries}
          onCancel={() => setPendingSeries([])}
        />
      ) : (
        <>
          <Selector<Mode>
            options={[
              { value: 'file',  label: 'File',  icon: <FileIcon />  },
              { value: 'paste', label: 'Paste', icon: <PasteIcon /> },
            ]}
            value={mode}
            onChange={onModeChange}
            className="mx-auto max-w-sm w-full"
          />
          {mode === 'file' ? (
            <FileDropZone onSeries={handleSeries} />
          ) : (
            <PasteTable onSeries={handleSeries} />
          )}
        </>
      )}
    </div>
  )
}
