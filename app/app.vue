<script setup lang="ts">
const { locale } = useI18n()

// Keep <html lang> in sync for screen readers (TalkBack) and hyphenation.
useHead({ htmlAttrs: { lang: locale } })
</script>

<template>
  <UApp>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
