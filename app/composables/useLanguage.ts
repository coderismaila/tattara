// Language choice, persisted on this device. Browser-language detection is off (ADR-010),
// so the app opens in Hausa unless the user picked English here.
export const LANGUAGE_STORAGE_KEY = 'tattara:locale'

export type AppLocale = 'ha' | 'en'
export const APP_LOCALES: readonly AppLocale[] = ['ha', 'en']

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value)
}

export function readSavedLanguage(): AppLocale | null {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isAppLocale(value) ? value : null
  }
  catch {
    return null
  }
}

export function useLanguage() {
  const { locale, setLocale } = useI18n()

  async function setLanguage(code: AppLocale) {
    await setLocale(code)
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
    }
    catch {
      // Storage can be unavailable (private mode, quota); the switch still works for this session.
    }
  }

  return { locale, setLanguage }
}
