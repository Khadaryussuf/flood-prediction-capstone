import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

import { postJson, request, setCsrfToken } from './api'
import type { User } from './types'

interface SessionResponse {
  user: User | null
  csrf_token: string
  providers?: Providers
}

/** Sign-in providers the server has set up */
export interface Providers {
  google: boolean
}

interface AuthState {
  user: User | null
  loading: boolean
  providers: Providers
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

// oxlint-disable-next-line react/only-export-components
export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  providers: { google: false },
  login: async () => {},
  logout: async () => {},
})

/** Keeps track of who is logged in. Login state itself lives on the server. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [providers, setProviders] = useState<Providers>({ google: false })

  const refresh = useCallback(async () => {
    const session = await request<SessionResponse>('/api/auth/session')
    setCsrfToken(session.csrf_token)
    setUser(session.user)
    setProviders({ google: session.providers?.google === true })
  }, [])

  useEffect(() => {
    refresh()
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
    // A request came back 401: the session ended on the server
    const ended = () => {
      refresh().catch(() => setUser(null))
    }
    window.addEventListener('floodwatch:session-ended', ended)
    return () => window.removeEventListener('floodwatch:session-ended', ended)
  }, [refresh])

  const login = async (email: string, password: string) => {
    const session = await postJson<SessionResponse>('/api/auth/login', { email, password })
    setCsrfToken(session.csrf_token)
    setUser(session.user)
  }

  const logout = async () => {
    const result = await postJson<{ csrf_token: string }>('/api/auth/logout', {})
    setCsrfToken(result.csrf_token)
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, providers, login, logout }}>{children}</AuthContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export const useAuth = () => useContext(AuthContext)
