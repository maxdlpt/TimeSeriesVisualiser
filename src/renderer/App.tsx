import { AppLayout } from "./components/layout/AppLayout"
import { GraphTab } from "./components/tabs/GraphTab"
import { UploadTab } from "./components/tabs/UploadTab"
import { SettingsTab } from "./components/tabs/SettingsTab"
import { useAppStore } from "./store/app"

export default function App() {
  const activeTab = useAppStore(s => s.activeTab)

  return (
    <AppLayout>
      {activeTab === 'graph' && <GraphTab />}
      {activeTab === 'upload' && <UploadTab />}
      {activeTab === 'settings' && <SettingsTab />}
    </AppLayout>
  )
}
