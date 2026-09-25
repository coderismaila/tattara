<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-default focus:p-3"
    >{{ t('a11y.skipToContent') }}</a>

    <header class="border-b-4 border-primary bg-default">
      <div class="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4">
        <NuxtLink
          to="/"
          class="rounded-md text-xl font-bold text-primary focus-visible:outline-2 focus-visible:outline-primary"
        >
          {{ t('app.name') }}
        </NuxtLink>
        <CommonLanguageSwitch />
      </div>
    </header>

    <main
      id="main"
      class="flex flex-1 flex-col"
    >
      <slot />
    </main>
  </div>
</template>
