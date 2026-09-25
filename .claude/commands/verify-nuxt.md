Verify the Nuxt setup is current and consistent:
1. Run `pnpm outdated` for nuxt, @nuxt/ui, @vite-pwa/nuxt, @nuxtjs/i18n, nuxt-auth-utils, drizzle-orm, maplibre-gl.
2. Check the Nuxt releases/security advisories for anything affecting our versions; recommend patch upgrades.
3. Confirm nuxt.config.ts still has future.compatibilityVersion: 5 and list any escape hatches, checking whether each can now be removed.
4. Run build and report any compat-5 warnings.
Summarise and propose a single upgrade commit.
