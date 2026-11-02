import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider, useTheme, type Theme } from './theme-provider'

let setThemeFromTest: (theme: Theme) => void = () => {}

function Probe() {
  setThemeFromTest = useTheme().setTheme
  return null
}

afterEach(() => {
  document.documentElement.classList.remove('dark')
  localStorage.clear()
})

describe('ThemeProvider', () => {
  it('puts the dark class on <html> and remembers the choice', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => setThemeFromTest('dark'))
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem('flood-dashboard-theme')).toBe('dark')
    act(() => setThemeFromTest('light'))
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('still switches theme when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => setThemeFromTest('dark'))
    expect(document.documentElement).toHaveClass('dark')
  })
})
