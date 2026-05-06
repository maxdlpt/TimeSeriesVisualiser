import { useState, useRef, useCallback } from 'react'
import { Upload, AlertCircle, Loader2 } from 'lucide-react'
import { parseCSVText, parseExcelBuffer } from '../../lib/parse'
import type { DataSeries } from '../../../shared/types'

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.tsv']

interface Props {
  onSeries: (series: DataSeries[]) => void
}

export function FileDropZone({ onSeries }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  const processFile = useCallback(async (file: File) => {
    setError(null)
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setError(`Unsupported file type "${ext}". Use CSV, TSV, or Excel (.xlsx/.xls).`)
      return
    }
    setIsLoading(true)
    try {
      let series: DataSeries[]
      if (ext === '.csv' || ext === '.tsv' || file.type === 'text/csv') {
        const text = await file.text()
        series = parseCSVText(text)
      } else {
        const buf = await file.arrayBuffer()
        series = parseExcelBuffer(buf)
      }
      if (series.length === 0) {
        setError('No valid series found. Check that the first column contains dates and other columns contain numbers.')
        return
      }
      onSeries(series)
    } catch (err) {
      setError(`Failed to parse "${file.name}": ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsLoading(false)
    }
  }, [onSeries])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragging(false)
    const files = e.dataTransfer.files
    if (files.length > 1) {
      setError('Please drop a single file. Multiple file upload is not supported.')
      return
    }
    const file = files[0]
    if (file) processFile(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    // Reset input so same file can be re-selected
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={e => { e.preventDefault() }}
        onDragEnter={e => { e.preventDefault(); dragCounter.current++; setIsDragging(true) }}
        onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDragging(false) } }}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-16 cursor-pointer transition-colors ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/40 hover:bg-primary/5'
        }`}
      >
        {isLoading ? (
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
        ) : (
          <Upload className="h-10 w-10 text-muted-foreground" />
        )}
        <div className="text-center">
          <p className="text-base font-medium text-foreground">
            {isLoading ? 'Parsing file…' : 'Drop CSV or Excel file here'}
          </p>
          {!isLoading && (
            <p className="text-sm text-muted-foreground mt-1">
              or click to browse · First column must be dates
            </p>
          )}
        </div>
        <input
          ref={inputRef}
          data-testid="file-input"
          type="file"
          accept=".csv,.xlsx,.xls,.tsv"
          className="hidden"
          onChange={handleFileInput}
        />
      </div>
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
