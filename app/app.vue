<script setup lang="ts">
const { locale } = useI18n()

// Keep <html lang> in sync for screen readers (TalkBack) and hyphenation.
useHead({
  htmlAttrs: { lang: locale },
  meta: [{ name: 'theme-color', content: '#1F3A68' }],
  link: [{ rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' }],
})
</script>

<template>
  <UApp>
    <!-- Injects <link rel="manifest"> (and theme meta) so Chrome can offer "Install app". -->
    <NuxtPwaManifest />
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
