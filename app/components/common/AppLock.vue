<script setup lang="ts">
import { getLocalSession } from '~/offline/local-session'

// Covers /app while it is locked, still deciding, or can't be unlocked on this phone (task 4.5). The page behind
// stays mounted (an unfinished capture survives the lock) but is inert and invisible (app layout).
const { t } = useI18n()
const lock = useAppLock()
const signOut = useSignOut()

const pin = ref('')
const busy = ref(false)
const remaining = ref<number | null>(null)
const formatError = ref(false)
const leadName = ref('')
const online = ref(true)
const pinInput = useTemplateRef<{ inputRef?: HTMLInputElement }>('pinInput')

const updateOnline = () => (online.value = navigator.onLine)
onMounted(() => {
  updateOnline()
  window.addEventListener('online', updateOnline)
  window.addEventListener('offline', updateOnline)
})
onBeforeUnmount(() => {
  window.removeEventListener('online', updateOnline)
  window.removeEventListener('offline', updateOnline)
})

watch(() => lock.state.value, async (state) => {
  if (state !== 'locked') return
  pin.value = ''
  remaining.value = null
  formatError.value = false
  leadName.value = (await getLocalSession().catch(() => undefined))?.fullName ?? ''
  await nextTick()
  pinInput.value?.inputRef?.focus()
}, { immediate: true })

async function submit() {
  if (busy.value) return
  formatError.value = !/^\d{6}$/.test(pin.value)
  if (formatError.value) return
  busy.value = true
  try {
    const result = await lock.unlock(pin.value)
    if (result.ok) return
    if (result.wiped) {
      await signOut()
      return
    }
    remaining.value = result.remaining
    pin.value = ''
    pinInput.value?.inputRef?.focus()
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-default"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="lock.state.value === 'checking' ? undefined : 'app-lock-title'"
    :aria-label="lock.state.value === 'checking' ? t('lock.checking') : undefined"
    data-testid="app-lock"
    :data-state="lock.state.value"
  >
    <div class="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div
        v-if="lock.state.value === 'checking'"
        class="flex justify-center"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-8 animate-spin text-primary motion-reduce:animate-none"
          aria-hidden="true"
        />
      </div>

      <template v-else-if="lock.state.value === 'locked'">
        <div class="flex flex-col gap-2">
          <UIcon
            name="i-lucide-lock"
            class="size-10 text-primary"
            aria-hidden="true"
          />
          <h1
            id="app-lock-title"
            class="text-2xl font-bold"
          >
            {{ t('lock.title') }}
          </h1>
          <p class="text-muted">
            {{ leadName ? t('lock.introNamed', { name: leadName }) : t('lock.intro') }}
          </p>
        </div>

        <form
          class="flex flex-col gap-4"
          novalidate
          @submit.prevent="submit"
        >
          <UFormField
            :label="t('auth.pin')"
            name="pin"
            size="xl"
          >
            <UInput
              ref="pinInput"
              v-model="pin"
              type="password"
              inputmode="numeric"
              autocomplete="off"
              maxlength="6"
              class="w-full"
              size="xl"
              :disabled="busy"
              data-testid="lock-pin"
            />
          </UFormField>

          <UAlert
            v-if="formatError"
            color="error"
            variant="subtle"
            role="alert"
            :title="t('auth.errors.pinFormat')"
            data-testid="lock-error"
          />
          <UAlert
            v-else-if="remaining !== null"
            color="error"
            variant="subtle"
            role="alert"
            :title="t('lock.wrongPin', { count: remaining }, remaining)"
            data-testid="lock-error"
          />

          <UButton
            type="submit"
            size="xl"
            block
            class="min-h-14 text-lg"
            :loading="busy"
            :label="t('lock.unlock')"
            data-testid="lock-submit"
          />
        </form>

        <div class="flex flex-col gap-2 border-t border-default pt-4">
          <p class="text-sm text-muted">
            {{ t('lock.forgotHelp') }}
          </p>
          <UButton
            color="neutral"
            variant="outline"
            size="xl"
            class="min-h-12 self-start"
            :disabled="busy"
            :label="t('auth.signOut')"
            data-testid="lock-sign-out"
            @click="signOut()"
          />
        </div>
      </template>

      <template v-else>
        <div class="flex flex-col gap-2">
          <UIcon
            name="i-lucide-log-in"
            class="size-10 text-primary"
            aria-hidden="true"
          />
          <h1
            id="app-lock-title"
            class="text-2xl font-bold"
          >
            {{ t('lock.needsSignIn.title') }}
          </h1>
          <p
            class="text-muted"
            data-testid="lock-needs-sign-in"
          >
            {{ online ? t('lock.needsSignIn.online') : t('lock.needsSignIn.offline') }}
          </p>
        </div>
        <UButton
          v-if="online"
          size="xl"
          block
          class="min-h-14 text-lg"
          :label="t('auth.signIn')"
          data-testid="lock-sign-in"
          @click="signOut()"
        />
      </template>
    </div>
  </div>
</template>
