"use client"
import { useState } from "react"
import { BarChart2, Upload, Settings, ChevronsRight } from "lucide-react"
import { useAppStore } from "../../store/app"
import type { ReactNode } from "react"

type Tab = 'graph' | 'upload' | 'settings'

interface OptionProps {
  icon: ReactNode
  title: string
  tab: Tab
  selected: Tab
  open: boolean
}

const Option = ({ icon, title, tab, selected, open }: OptionProps) => {
  const setActiveTab = useAppStore(s => s.setActiveTab)
  const isSelected = selected === tab
  return (
    <button
      onClick={() => setActiveTab(tab)}
      className={`relative flex h-11 w-full items-center rounded-md transition-all duration-200 ${
        isSelected
          ? "bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 shadow-sm border-l-2 border-blue-500"
          : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200"
      }`}
    >
      <div className="grid h-full w-12 place-content-center">{icon}</div>
      {open && (
        <span className="text-sm font-medium">{title}</span>
      )}
    </button>
  )
}

export const Sidebar = () => {
  const [open, setOpen] = useState(true)
  const activeTab = useAppStore(s => s.activeTab)

  return (
    <nav
      className={`sticky top-0 h-screen shrink-0 border-r transition-all duration-300 ease-in-out ${
        open ? 'w-56' : 'w-16'
      } border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2 shadow-sm flex flex-col`}
    >
      {/* Logo */}
      <div className="mb-6 border-b border-gray-200 dark:border-gray-800 pb-4">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="grid size-10 shrink-0 place-content-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 shadow-sm">
            <BarChart2 className="h-5 w-5 text-white" />
          </div>
          {open && <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">TimeSeries</span>}
        </div>
      </div>

      {/* Main nav */}
      <div className="space-y-1 flex-1">
        <Option icon={<BarChart2 className="h-4 w-4" />} title="Graph" tab="graph" selected={activeTab} open={open} />
        <Option icon={<Upload className="h-4 w-4" />} title="Upload" tab="upload" selected={activeTab} open={open} />
      </div>

      {/* Settings at bottom, above collapse */}
      <div className="space-y-1 border-t border-gray-200 dark:border-gray-800 pt-2 pb-12">
        <Option icon={<Settings className="h-4 w-4" />} title="Settings" tab="settings" selected={activeTab} open={open} />
      </div>

      {/* Toggle collapse */}
      <button
        onClick={() => setOpen(!open)}
        className="absolute bottom-0 left-0 right-0 border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center p-3">
          <div className="grid size-10 place-content-center">
            <ChevronsRight
              className={`h-4 w-4 transition-transform duration-300 text-gray-500 dark:text-gray-400 ${open ? "rotate-180" : ""}`}
            />
          </div>
          {open && <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Hide</span>}
        </div>
      </button>
    </nav>
  )
}
