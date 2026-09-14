export const THEME_STORAGE_KEY = 'redax-theme'
export const THEME_COLORS = {
  light: '#F4F6F8',
  dark: '#2A2825',
}

export function getSystemTheme() {
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
  } catch {
    /* matchMedia unavailable */
  }
  return 'light'
}

export function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* private mode / blocked storage */
  }
  return null
}

export function resolveTheme() {
  return readStoredTheme() || getSystemTheme()
}

export function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light'
  document.documentElement.setAttribute('data-theme', next)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLORS[next])
}

export function persistTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light'
  applyTheme(next)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    /* ignore quota / private mode */
  }
}

export function subscribeSystemTheme(onChange) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e) => {
    if (readStoredTheme()) return
    onChange(e.matches ? 'dark' : 'light')
  }
  if (mq.addEventListener) mq.addEventListener('change', handler)
  else if (mq.addListener) mq.addListener(handler)
  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', handler)
    else if (mq.removeListener) mq.removeListener(handler)
  }
}
