<script setup lang="ts">
import { getStoragePersisted } from '~/offline/background'

definePageMeta({ layout: 'app', titleKey: 'nav.settings' })

const { t } = useI18n()
const signOutOfPhone = useSignOut()
const signingOut = ref(false)

// ARCHITECTURE §5: warn when the browser refused persistent storage (unsent captures could be evicted).
const storageRefused = ref(false)
onMounted(async () => {
  storageRefused.value = (await getStoragePersisted().catch(() => undefined)) === false
})

// Ends the server session when reachable and always wipes this phone's Tattara data (4.5).
async function signOut() {
  signingOut.value = true
  try {
    await signOutOfPhone()
  }
  finally {
    signingOut.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-2xl font-bold">
      {{ t('nav.settings') }}
    </h1>

    <UAlert
      v-if="storageRefused"
      color="warning"
      variant="subtle"
      icon="i-lucide-hard-drive"
      :title="t('settings.storageTitle')"
      :description="t('settings.storageHelp')"
      data-testid="settings-storage-warning"
    />

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

    <section
      aria-labelledby="settings-account"
      class="flex flex-col gap-3 rounded-lg border border-default bg-default p-4"
    >
      <h2
        id="settings-account"
        class="text-lg font-semibold"
      >
        {{ t('settings.account') }}
      </h2>
      <p class="text-muted">
        {{ t('settings.signOutHelp') }}
      </p>
      <UButton
        color="neutral"
        variant="outline"
        size="xl"
        class="min-h-12 self-start"
        :loading="signingOut"
        :label="t('auth.signOut')"
        data-testid="sign-out"
        @click="signOut"
      />
    </section>
  </div>
</template>
