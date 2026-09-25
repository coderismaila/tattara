<script setup lang="ts">
definePageMeta({ layout: 'app', titleKey: 'nav.settings' })

const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-2xl font-bold">
      {{ t('nav.settings') }}
    </h1>

    <section
      aria-labelledby="settings-language"
      class="flex flex-col gap-3 rounded-lg border border-default bg-default p-4"
    >
      <h2
        id="settings-language"
        class="text-lg font-semibold"
      >
        {{ t('lang.label') }}
      </h2>
      <p class="text-muted">
        {{ t('settings.languageHelp') }}
      </p>
      <CommonLanguageSwitch />
    </section>
  </div>
</template>
