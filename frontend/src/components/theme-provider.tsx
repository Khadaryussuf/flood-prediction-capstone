import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'flood-dashboard-theme'

// localStorage can be unavailable (private windows, blocked storage), so
// every access is wrapped and the page still works without it.
function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // ignore
  }
  return 'system'
}

function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // ignore
  }
}

function systemPrefersDark() {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeState>({ theme: 'system', setTheme: () => {} })

/** Puts the "dark" class on <html> when the chosen (or system) theme is dark. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark())
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return
    // Follow the operating system while "system" is chosen
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [theme])

  const setTheme = (next: Theme) => {
    storeTheme(next)
    setThemeState(next)
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export const useTheme = () => useContext(ThemeContext)
