<script setup lang="ts">
const { t } = useI18n()

useHead({ title: () => t('app.name') })
</script>

<template>
  <UContainer class="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
    <h1 class="text-3xl font-bold text-primary">
      {{ t('app.name') }}
    </h1>
    <p class="text-muted">
      {{ t('app.tagline') }}
    </p>
    <!-- TODO(2.4): link to /login once it exists -->
    <UButton
      size="xl"
      class="min-h-12"
      :label="t('auth.signIn')"
    />
  </UContainer>
</template>
