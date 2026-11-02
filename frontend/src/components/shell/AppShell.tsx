import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Bell,
  FileSearch,
  LayoutDashboard,
  LogOut,
  Menu,
  PlayCircle,
  Settings,
  TrendingUp,
  UserRound,
  Waves,
  type LucideIcon,
} from 'lucide-react'

import { DisclaimerStrip } from '@/components/dashboard/DisclaimerStrip'
import { AlertBell } from '@/components/shell/AlertBell'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  Icon: LucideIcon
  adminOnly?: boolean
}

const MAIN_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/trends', label: 'Historical Trends', Icon: TrendingUp },
  { to: '/alerts', label: 'Alerts', Icon: Bell },
  { to: '/settings', label: 'Settings', Icon: Settings, adminOnly: true },
  { to: '/evidence', label: 'Model evidence', Icon: FileSearch },
]
const DEMO_NAV: NavItem = { to: '/demo', label: 'Demo mode', Icon: PlayCircle }

export const ROLE_LABELS = { admin: 'Administrator', responder: 'Responder' } as const

function NavEntry({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { to, label, Icon } = item
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {label}
    </NavLink>
  )
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  const items = MAIN_NAV.filter((item) => !item.adminOnly || user?.role === 'admin')
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-1 p-3">
      {items.map((item) => <NavEntry key={item.to} item={item} onNavigate={onNavigate} />)}
      <div className="mt-auto border-t pt-3">
        <NavEntry item={DEMO_NAV} onNavigate={onNavigate} />
      </div>
    </nav>
  )
}

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Waves className="size-4.5" aria-hidden />
      </span>
      <span className="text-base font-semibold">FloodWatch</span>
    </span>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  if (!user) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={`Account: ${user.name}`}>
          <UserRound aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>
          <span className="block text-sm text-foreground">{user.name}</span>
          <span className="block font-normal">{ROLE_LABELS[user.role]}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut aria-hidden />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The frame around every logged-in page: sidebar, top bar and disclaimer. */
export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()
  const current = [...MAIN_NAV, DEMO_NAV].find((item) => item.to === pathname)?.label ?? 'FloodWatch'

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="hidden w-60 shrink-0 border-r bg-card lg:block">
        <div className="sticky top-0 flex h-svh flex-col">
          <div className="flex h-14 items-center border-b px-4"><Brand /></div>
          <NavLinks />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[1000] flex h-14 items-center gap-2 border-b bg-card px-4">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 gap-0 p-0">
              <SheetHeader className="border-b">
                <SheetTitle><Brand /></SheetTitle>
                <SheetDescription className="sr-only">Main menu</SheetDescription>
              </SheetHeader>
              <NavLinks onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <h1 className="min-w-0 truncate text-base font-semibold">{current}</h1>
          <div className="ml-auto flex items-center gap-2">
            <AlertBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <DisclaimerStrip />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
