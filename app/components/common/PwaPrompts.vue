<script setup lang="ts">
// Install and update prompts (task 4.1). Calm cards above the bottom navigation, never a blocking modal (UX §2).
// `$pwa` is undefined when the PWA module is off (dev, tests): then nothing shows.
const { t } = useI18n()
const pwa = useNuxtApp().$pwa

const showUpdate = computed(() => !!pwa?.needRefresh)
const showInstall = computed(() => !showUpdate.value && !!pwa?.showInstallPrompt && !pwa?.isPWAInstalled)
const updating = ref(false)

async function reload() {
  updating.value = true
  await pwa?.updateServiceWorker(true)
}
</script>

<template>
  <div
    v-if="showUpdate || showInstall"
    class="fixed inset-x-0 bottom-20 z-30 px-4 md:bottom-4"
  >
    <div
      class="mx-auto flex max-w-lg flex-col gap-3 rounded-2xl border border-default bg-default p-4 shadow-lg"
      role="status"
      :data-testid="showUpdate ? 'pwa-update' : 'pwa-install'"
    >
      <template v-if="showUpdate">
        <p class="font-semibold">
          {{ t('pwa.updateTitle') }}
        </p>
        <p class="text-muted">
          {{ t('pwa.updateBody') }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton
            class="min-h-12"
            icon="i-lucide-refresh-cw"
            :loading="updating"
            :label="t('pwa.reload')"
            data-testid="pwa-reload"
            @click="reload"
          />
          <UButton
            class="min-h-12"
            variant="ghost"
            color="neutral"
            :label="t('pwa.later')"
            @click="pwa?.cancelPrompt()"
          />
        </div>
      </template>
      <template v-else>
        <p class="font-semibold">
          {{ t('pwa.installTitle') }}
        </p>
        <p class="text-muted">
          {{ t('pwa.installBody') }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton
            class="min-h-12"
            icon="i-lucide-download"
            :label="t('pwa.install')"
            data-testid="pwa-install-button"
            @click="pwa?.install()"
          />
          <UButton
            class="min-h-12"
            variant="ghost"
            color="neutral"
            :label="t('pwa.notNow')"
            @click="pwa?.cancelInstall()"
          />
        </div>
      </template>
    </div>
  </div>
</template>
