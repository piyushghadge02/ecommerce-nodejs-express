import { ref } from 'vue'

/** Persisted light/dark theme for the storefront. Defaults to light. */
const THEME_KEY = 'ecom-theme'

export const isDark = ref(false)

function apply(dark) {
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  } catch {
    /* storage unavailable — theme still applies for this session */
  }
}

/** Read the saved preference (if any) and apply it. Call once at startup. */
export function initTheme() {
  let dark = false
  try {
    dark = localStorage.getItem(THEME_KEY) === 'dark'
  } catch {
    dark = false
  }
  apply(dark)
}

export function toggleTheme() {
  apply(!isDark.value)
}
