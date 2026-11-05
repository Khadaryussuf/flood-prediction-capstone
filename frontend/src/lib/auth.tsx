import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

import { postJson, request, setCsrfToken } from './api'
import type { User } from './types'

interface SessionResponse {
  user: User | null
  csrf_token: string
}

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

// oxlint-disable-next-line react/only-export-components
export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
})

/** Keeps track of who is logged in. Login state itself lives on the server. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const session = await request<SessionResponse>('/api/auth/session')
    setCsrfToken(session.csrf_token)
    setUser(session.user)
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

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export const useAuth = () => useContext(AuthContext)
