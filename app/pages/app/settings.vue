<script setup lang="ts">
definePageMeta({ layout: 'app', titleKey: 'nav.settings' })

const { t } = useI18n()
const { clear } = useUserSession()
const signingOut = ref(false)

async function signOut() {
  signingOut.value = true
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  }
  finally {
    // Local state is cleared even offline; the server session is cleared when reachable.
    await clear().catch(() => {})
    signingOut.value = false
    await navigateTo('/login', { replace: true })
  }
}
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
