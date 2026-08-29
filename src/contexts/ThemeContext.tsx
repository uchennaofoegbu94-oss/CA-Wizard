import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  /** What the user actually picked — including 'system' */
  theme: ThemePreference
  /** What's actually applied right now, after resolving 'system' against the OS */
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'ca-wizard-theme'

function getSystemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolve(pref: ThemePreference): 'light' | 'dark' {
  return pref === 'system' ? (getSystemPrefersDark() ? 'dark' : 'light') : pref
}

// Note on avoiding a flash of the wrong theme on load: applying the .dark
// class only from a React useEffect would run after first paint, so
// anyone with a dark preference would see a flash of light theme first.
// index.html has a small blocking inline script that reads the same
// localStorage key and applies the class before React even mounts — this
// context just needs to stay in sync with whatever that script already
// set, not fight it.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    if (typeof window === 'undefined') return 'system'
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
  })

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => resolve(theme))

  const setTheme = (next: ThemePreference) => {
    setThemeState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }

  // Apply the resolved theme to <html> whenever the preference changes,
  // and (for 'system') whenever the OS preference itself changes live —
  // e.g. a laptop switching to dark mode automatically at sunset while
  // the app is already open.
  useEffect(() => {
    const apply = () => {
      const next = resolve(theme)
      setResolvedTheme(next)
      document.documentElement.classList.toggle('dark', next === 'dark')
    }
    apply()

    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      mql.addEventListener('change', apply)
      return () => mql.removeEventListener('change', apply)
    }
  }, [theme])

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
