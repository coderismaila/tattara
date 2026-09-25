<script setup lang="ts">
const { t } = useI18n()
const { locale, setLanguage } = useLanguage()

// Endonyms and codes stay untranslated so either audience can find their language.
const options = [
  { code: 'ha', short: 'HA', name: 'Hausa' },
  { code: 'en', short: 'EN', name: 'English' },
] as const
</script>

<template>
  <UFieldGroup
    role="group"
    :aria-label="t('lang.switch')"
  >
    <UButton
      v-for="option in options"
      :key="option.code"
      :label="option.short"
      :aria-label="option.name"
      :aria-pressed="locale === option.code"
      :lang="option.code"
      :color="locale === option.code ? 'primary' : 'neutral'"
      :variant="locale === option.code ? 'solid' : 'outline'"
      class="min-h-12 min-w-12 justify-center font-semibold"
      :data-testid="`lang-${option.code}`"
      @click="setLanguage(option.code)"
    />
  </UFieldGroup>
</template>
