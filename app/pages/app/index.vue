<script setup lang="ts">
definePageMeta({ layout: 'app', titleKey: 'nav.home' })

const { t } = useI18n()
</script>

<template>
  <section class="flex flex-col gap-2">
    <h1 class="text-2xl font-bold">
      {{ t('home.welcome') }}
    </h1>
    <!-- Role-aware home arrives in 6.2. -->
    <p class="text-muted">
      {{ t('home.placeholder') }}
    </p>
  </section>
</template>
