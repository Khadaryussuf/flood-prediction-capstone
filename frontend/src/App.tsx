import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'

import { AppShell } from '@/components/shell/AppShell'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth'
import { DashboardPage } from '@/pages/DashboardPage'
import EvidencePage from '@/pages/EvidencePage'
import { LoginPage } from '@/pages/LoginPage'
import { Placeholder } from '@/pages/Placeholder'
import { SettingsPage } from '@/pages/SettingsPage'
import { SignupPage } from '@/pages/SignupPage'

/** Shows its pages only when logged in. The server enforces this too; this
 *  just sends people to the right screen. */
function RequireLogin() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Skeleton className="m-6 h-40" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

function RequireAdmin() {
  const { user } = useAuth()
  return user?.role === 'admin' ? <Outlet /> : <Navigate to="/dashboard" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route element={<RequireLogin />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/trends" element={<Placeholder title="Historical Trends" />} />
        <Route path="/alerts" element={<Placeholder title="Alerts" />} />
        <Route path="/evidence" element={<EvidencePage />} />
        <Route path="/demo" element={<Placeholder title="Demo mode" />} />
        <Route element={<RequireAdmin />}>
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
