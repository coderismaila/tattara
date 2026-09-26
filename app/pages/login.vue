<script setup lang="ts">
import { loginSchema, otpCodeSchema, phoneSchema } from '~~/shared/schemas/auth'

const { t } = useI18n()
const route = useRoute()
const { fetch: refreshSession } = useUserSession()

useHead({ title: () => t('auth.signIn') })

const step = ref<'credentials' | 'code'>('credentials')
const phone = ref('')
const pin = ref('')
const code = ref('')
const busy = ref(false)
// The page is server-rendered: until it is interactive, typing would be wiped and a submit would be a plain browser
// form post (losing the invite token). Controls stay disabled until then; slow 3G phones hit this for real.
const ready = ref(false)
onMounted(() => {
  ready.value = true
})
const error = ref<AuthErrorMessage | null>(null)
const notice = ref('')
const codeInput = useTemplateRef<{ inputRef?: HTMLInputElement }>('codeInput')

/** Only in-app destinations (no open redirects). */
const nextPath = computed(() => {
  const next = typeof route.query.next === 'string' ? route.query.next : ''
  return next.startsWith('/app') ? next : '/app'
})

async function finish() {
  await refreshSession()
  await navigateTo(nextPath.value, { replace: true })
}

async function submitCredentials() {
  error.value = null
  notice.value = ''
  const parsed = loginSchema.safeParse({ phone: phone.value, pin: pin.value, deviceId: getDeviceId() })
  if (!parsed.success) {
    error.value = { key: parsed.error.issues[0]!.message }
    return
  }
  busy.value = true
  try {
    const res = await $fetch.raw('/api/auth/login', { method: 'POST', body: parsed.data })
    if (res.status === 202) {
      step.value = 'code'
      code.value = ''
      await nextTick()
      codeInput.value?.inputRef?.focus()
      return
    }
    await finish()
  }
  catch (e) {
    error.value = authErrorMessage(e)
    pin.value = ''
  }
  finally {
    busy.value = false
  }
}

async function submitCode() {
  error.value = null
  notice.value = ''
  const checked = otpCodeSchema.safeParse(code.value.trim())
  if (!checked.success) {
    error.value = { key: checked.error.issues[0]!.message }
    return
  }
  busy.value = true
  try {
    await $fetch('/api/auth/otp/verify', {
      method: 'POST',
      body: { phone: phone.value, code: checked.data, deviceId: getDeviceId() },
    })
    await finish()
  }
  catch (e) {
    error.value = authErrorMessage(e)
  }
  finally {
    busy.value = false
  }
}

async function resend() {
  error.value = null
  notice.value = ''
  const parsed = phoneSchema.safeParse(phone.value)
  if (!parsed.success) return
  try {
    await $fetch('/api/auth/otp/resend', { method: 'POST', body: { phone: parsed.data } })
    notice.value = t('auth.resent')
  }
  catch (e) {
    error.value = authErrorMessage(e)
  }
}

function back() {
  step.value = 'credentials'
  error.value = null
  notice.value = ''
  pin.value = ''
}
</script>

<template>
  <UContainer class="flex w-full max-w-md flex-1 flex-col gap-6 py-10">
    <template v-if="step === 'credentials'">
      <h1 class="text-2xl font-bold text-primary">
        {{ t('auth.signIn') }}
      </h1>
      <form
        class="flex flex-col gap-5"
        novalidate
        @submit.prevent="submitCredentials"
      >
        <UFormField
          :label="t('auth.phone')"
          :help="t('auth.phoneHelp')"
          name="phone"
          size="xl"
        >
          <UInput
            v-model="phone"
            :disabled="!ready"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            class="w-full"
            size="xl"
            data-testid="login-phone"
          />
        </UFormField>
        <UFormField
          :label="t('auth.pin')"
          :help="t('auth.pinHelp')"
          name="pin"
          size="xl"
        >
          <UInput
            v-model="pin"
            :disabled="!ready"
            type="password"
            inputmode="numeric"
            autocomplete="current-password"
            maxlength="6"
            class="w-full"
            size="xl"
            data-testid="login-pin"
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
          :label="busy ? t('auth.signingIn') : t('auth.signIn')"
          data-testid="login-submit"
        />
      </form>
    </template>

    <template v-else>
      <h1 class="text-2xl font-bold text-primary">
        {{ t('auth.codeTitle') }}
      </h1>
      <p class="text-muted">
        {{ t('auth.codeIntro') }}
      </p>
      <form
        class="flex flex-col gap-5"
        novalidate
        @submit.prevent="submitCode"
      >
        <UFormField
          :label="t('auth.code')"
          name="code"
          size="xl"
        >
          <UInput
            ref="codeInput"
            v-model="code"
            :disabled="!ready"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            class="w-full"
            size="xl"
            data-testid="login-code"
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
        <p
          v-if="notice"
          role="status"
          class="text-success"
        >
          {{ notice }}
        </p>
        <UButton
          type="submit"
          :disabled="!ready"
          size="xl"
          block
          class="min-h-12"
          :loading="busy"
          :label="t('auth.verify')"
          data-testid="code-submit"
        />
        <div class="flex justify-between gap-3">
          <UButton
            variant="ghost"
            color="neutral"
            class="min-h-12"
            :label="t('auth.back')"
            @click="back"
          />
          <UButton
            variant="ghost"
            class="min-h-12"
            :label="t('auth.resend')"
            @click="resend"
          />
        </div>
      </form>
    </template>
  </UContainer>
</template>
