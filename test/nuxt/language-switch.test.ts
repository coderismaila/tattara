import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import { CommonLanguageSwitch } from '#components'
import { LANGUAGE_STORAGE_KEY, readSavedLanguage } from '~/composables/useLanguage'

// The switch plus a translated string, to prove text updates in place (no reload).
// Locale messages load lazily, so assertions poll until the text updates.
const Harness = defineComponent({
  setup() {
    const { t } = useI18n()
    return () => h('div', [h(CommonLanguageSwitch), h('p', { 'data-testid': 'text' }, t('nav.settings'))])
  },
})

describe('LanguageSwitch', () => {
  afterEach(async () => {
    localStorage.clear()
    await useNuxtApp().$i18n.setLocale('ha')
  })

  it('starts in Hausa with HA pressed', async () => {
    const wrapper = await mountSuspended(Harness)
    expect(wrapper.get('[data-testid="text"]').text()).toBe('Saituna')
    expect(wrapper.get('[data-testid="lang-ha"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="lang-en"]').attributes('aria-pressed')).toBe('false')
  })

  it('switches strings to English in place and saves the choice', async () => {
    const wrapper = await mountSuspended(Harness)

    await wrapper.get('[data-testid="lang-en"]').trigger('click')
    await expect.poll(() => wrapper.get('[data-testid="text"]').text()).toBe('Settings')
    expect(wrapper.get('[data-testid="lang-en"]').attributes('aria-pressed')).toBe('true')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')
    expect(readSavedLanguage()).toBe('en')
  })

  it('switches back to Hausa', async () => {
    const wrapper = await mountSuspended(Harness)
    await wrapper.get('[data-testid="lang-en"]').trigger('click')
    await expect.poll(() => wrapper.get('[data-testid="text"]').text()).toBe('Settings')
    await wrapper.get('[data-testid="lang-ha"]').trigger('click')
    await expect.poll(() => wrapper.get('[data-testid="text"]').text()).toBe('Saituna')
    expect(readSavedLanguage()).toBe('ha')
  })

  it('names each option for screen readers', async () => {
    const wrapper = await mountSuspended(CommonLanguageSwitch)
    expect(wrapper.get('[data-testid="lang-ha"]').attributes('aria-label')).toBe('Hausa')
    expect(wrapper.get('[data-testid="lang-en"]').attributes('aria-label')).toBe('English')
  })
})

describe('readSavedLanguage', () => {
  afterEach(() => localStorage.clear())

  it('ignores missing or unknown values', () => {
    expect(readSavedLanguage()).toBeNull()
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr')
    expect(readSavedLanguage()).toBeNull()
  })
})
