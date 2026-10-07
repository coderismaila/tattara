<script setup lang="ts">
import { inviteTokenSchema, setupSchema } from '~~/shared/schemas/auth'

const { t } = useI18n()
const route = useRoute()
const { fetch: refreshSession } = useUserSession()
const rememberSignIn = useLocalSignIn()

useHead({ title: () => t('auth.setupTitle') })

const token = computed(() => (typeof route.query.t === 'string' ? route.query.t : ''))
const tokenOk = computed(() => inviteTokenSchema.safeParse(token.value).success)

const pin = ref('')
const confirm = ref('')
const busy = ref(false)
// The page is server-rendered: until it is interactive, typing would be wiped and a submit would be a plain browser
// form post (losing the invite token). Controls stay disabled until then; slow 3G phones hit this for real.
const ready = ref(false)
onMounted(() => {
  ready.value = true
})
const error = ref<AuthErrorMessage | null>(null)

async function submit() {
  error.value = null
  const parsed = setupSchema.safeParse({ token: token.value, pin: pin.value, deviceId: getDeviceId() })
  if (!parsed.success) {
    error.value = { key: parsed.error.issues[0]!.message }
    return
  }
  if (pin.value !== confirm.value) {
    error.value = { key: 'auth.errors.pinMismatch' }
    return
  }
  busy.value = true
  try {
    await $fetch('/api/auth/setup', { method: 'POST', body: parsed.data })
    await refreshSession()
    try {
      await rememberSignIn(pin.value) // offline lock verifier (4.5)
    }
    catch {
      error.value = { key: 'auth.errors.deviceStorage' }
      return
    }
    await navigateTo('/app', { replace: true })
  }
  catch (e) {
    error.value = authErrorMessage(e)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UContainer class="flex w-full max-w-md flex-1 flex-col gap-6 py-10">
    <h1 class="text-2xl font-bold text-primary">
      {{ t('auth.setupTitle') }}
    </h1>

    <UAlert
      v-if="!tokenOk"
      color="error"
      variant="subtle"
      role="alert"
      :title="t('auth.errors.tokenInvalid')"
      data-testid="auth-error"
    />

    <template v-else>
      <p class="text-muted">
        {{ t('auth.setupIntro') }}
      </p>
      <form
        class="flex flex-col gap-5"
        novalidate
        @submit.prevent="submit"
      >
        <UFormField
          :label="t('auth.newPin')"
          name="pin"
          size="xl"
        >
          <UInput
            v-model="pin"
            :disabled="!ready"
            type="password"
            inputmode="numeric"
            autocomplete="new-password"
            maxlength="6"
            class="w-full"
            size="xl"
            data-testid="setup-pin"
          />
        </UFormField>
        <UFormField
          :label="t('auth.confirmPin')"
          name="confirm"
          size="xl"
        >
          <UInput
            v-model="confirm"
            :disabled="!ready"
            type="password"
            inputmode="numeric"
            autocomplete="new-password"
            maxlength="6"
            class="w-full"
            size="xl"
            data-testid="setup-confirm"
          />
        </UFormField>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          role="alert"
          :title="t(error.key, error.params ?? {})"
          data-testid="auth-error"
        />
        <UButton
          type="submit"
          :disabled="!ready"
          size="xl"
          block
          class="min-h-12"
          :loading="busy"
          :label="t('auth.setupSubmit')"
          data-testid="setup-submit"
        />
      </form>
    </template>
  </UContainer>
</template>
