// Restores the language saved on this device (see useLanguage). No network needed.
export default defineNuxtPlugin({
  name: 'tattara:language',
  async setup(nuxtApp) {
    const saved = readSavedLanguage()
    if (!saved || saved === nuxtApp.$i18n.locale.value) return

    // Prerendered public pages hydrate in Hausa; switch after hydration to avoid a mismatch.
    if (nuxtApp.isHydrating) {
      nuxtApp.hook('app:suspense:resolve', () => nuxtApp.$i18n.setLocale(saved))
    }
    else {
      await nuxtApp.$i18n.setLocale(saved)
    }
  },
})
