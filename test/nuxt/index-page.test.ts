import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import IndexPage from '~/pages/index.vue'

describe('index page', () => {
  it('renders in Hausa by default with a sign-in link to /login', async () => {
    const page = await mountSuspended(IndexPage)

    expect(page.find('h1').text()).toBe('Tattara')
    expect(page.text()).toContain('Rijistar magoya baya ta Arewa maso Yamma')
    const signIn = page.find('a[href="/login"]')
    expect(signIn.exists()).toBe(true)
    expect(signIn.text()).toBe('Shiga')
  })
})
