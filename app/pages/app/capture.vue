<script setup lang="ts">
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import type { AgeBand, ConsentLanguage, Gender, HasPvc, SupportLevel } from '~~/shared/constants/enums'
import { CURRENT_CONSENT_VERSION, consentScript } from '~~/shared/constants/consent'
import { supporterFormSchema, type SupporterForm, type SupporterFormOutput } from '~~/shared/schemas/supporter'
import type { SupporterInput } from '~~/shared/types/supporter'
import { newId } from '~~/shared/utils/uuid'
import { normalizePhone } from '~~/shared/utils/phone'
import { getLocalSession, type LocalSession } from '~/offline/local-session'
import { countLocalPhone, discardCapture, getRejected, removeRejected, saveCapture } from '~/offline/outbox'
import { requestBackgroundSync } from '~/offline/background'

// Add supporter (UX §4.1, PRD US-4…US-7). One scroll, a big Save, only name/phone/support/PVC/consent required.
// Local-first (4.2, ADR-037): saved on the phone and queued, then sent at once when online.
definePageMeta({ layout: 'app', titleKey: 'nav.capture' })

const { t, locale } = useI18n()
const toast = useToast()
const config = useRuntimeConfig()
const gps = useSilentGps()

const { data: me } = await useFetch('/api/auth/me', { key: 'me' })
// Offline, /api/auth/me fails: the phone's own copy of the session (4.5) names the lead's PU.
const local = ref<LocalSession | null>(null)
onMounted(async () => {
  local.value = (await getLocalSession().catch(() => undefined)) ?? null
})
const role = computed(() => me.value?.user.role ?? local.value?.role ?? null)
const unit = computed(() => me.value?.unit ?? local.value?.unit ?? null)
const isPuLead = computed(() => role.value === 'PU_LEAD')

// Controls stay disabled until hydrated: typing before hydration would be lost on slow phones (ADR-024).
const mounted = ref(false)
onMounted(() => (mounted.value = true))

/** What the inputs hold before validation (unchosen chips are undefined). */
interface CaptureState {
  fullName: string
  phone: string
  address: string
  gender?: Gender
  ageBand?: AgeBand
  supportLevel?: SupportLevel
  hasPvc?: HasPvc
  volunteer: boolean
  sharedPhone: boolean
  consentGiven: boolean
}
const blank = (): CaptureState => ({
  fullName: '',
  phone: '',
  address: '',
  gender: undefined,
  ageBand: undefined,
  supportLevel: undefined,
  hasPvc: undefined,
  volunteer: false,
  sharedPhone: false,
  consentGiven: false,
})
const state = reactive<CaptureState>(blank())
/** The same object, typed as UForm expects (the consent tick's schema type is literally `true`). */
const formState = state as unknown as Partial<SupporterForm>

// Consent: the script is read in the supporter's language (default: the app's); the tick time is consentAt.
const consentLanguage = ref<ConsentLanguage>(locale.value === 'en' ? 'en' : 'ha')
const consentVersion = computed(() => CURRENT_CONSENT_VERSION[consentLanguage.value])
const script = computed(() => consentScript(consentVersion.value, config.public.orgName))
const consentAt = ref<string | null>(null)
watch(() => state.consentGiven, ticked => (consentAt.value = ticked ? new Date().toISOString() : null))

const { genderItems, ageItems, supportItems, pvcItems } = useSupporterOptions()

// Fix (Sync screen, 4.4): `?fix=<id>` fills the form from a capture the server refused. Saving makes a new capture
// (new id, consent ticked again now) and then drops the refused copy.
const route = useRoute()
const router = useRouter()
const fixId = ref<string | null>(null)
const fixGone = ref(false)
onMounted(async () => {
  const id = typeof route.query.fix === 'string' ? route.query.fix : null
  if (!id) return
  const refused = await getRejected(id).catch(() => undefined)
  if (!refused) {
    fixGone.value = true
    return
  }
  fixId.value = id
  Object.assign(state, {
    ...blank(),
    fullName: refused.fullName,
    phone: refused.phone,
    address: refused.address ?? '',
    gender: refused.gender ?? undefined,
    ageBand: refused.ageBand ?? undefined,
    supportLevel: refused.supportLevel,
    hasPvc: refused.hasPvc,
    volunteer: refused.volunteer,
    sharedPhone: refused.sharedPhone,
  })
  consentLanguage.value = refused.consentLanguage
})

async function finishFix() {
  if (!fixId.value) return
  await removeRejected(fixId.value).catch(() => false)
  fixId.value = null
  await router.replace({ query: {} })
}

const form = useTemplateRef('form')
const nameInput = useTemplateRef('nameInput')
const saving = ref(false)
const saveError = ref<string | null>(null)
const savedThisSession = useState('capture:savedThisSession', () => 0)

const gpsLabel = computed(() => {
  const fix = gps.fix.value
  if (gps.status.value === 'ok' && fix) return t('capture.gps.ok', { metres: fix.accuracyM ?? '?' })
  return t(`capture.gps.${gps.status.value}`)
})

/** UForm disables its controls while validating/submitting: wait until `el` is enabled again, then focus it. */
function focusWhenEnabled(el: HTMLElement | null | undefined, tries = 40) {
  if (!el) return
  if (!(el as HTMLInputElement).disabled) el.focus()
  else if (tries > 0) setTimeout(() => focusWhenEnabled(el, tries - 1), 25)
}

function focusName() {
  nextTick(() => focusWhenEnabled(nameInput.value?.inputRef))
}

/** After a failed save, move focus to the first field with an error (keyboard and TalkBack users land on it). */
function onError(event: FormErrorEvent) {
  const first = event.errors[0]
  if (!first) return
  const byId = first.id ? document.getElementById(first.id) : null
  const target = byId?.matches('input, button, textarea, [tabindex]')
    ? byId
    : document.querySelector<HTMLElement>(`[data-capture-field="${first.name}"] :is(input, button, [role="radio"])`)
  nextTick(() => focusWhenEnabled(target))
}

// ── Duplicate phone notice (US-7): checked when the phone field is left; online against the whole system, offline
// (or if the server can't answer) against the supporters on this phone for this PU. ──
interface PhoneCheck { countInSystem: number, samePu: boolean, limitReached: boolean }
const phoneCheck = ref<{ phone: string, result: PhoneCheck } | null>(null)

async function localPhoneCheck(phone: string): Promise<PhoneCheck | null> {
  if (!unit.value) return null
  const n = await countLocalPhone(unit.value.code, phone).catch(() => 0)
  return { countInSystem: n, samePu: n > 0, limitReached: false } // the limit is the server's to judge
}

async function checkPhoneNumber() {
  const phone = normalizePhone(state.phone)
  if (!phone) {
    phoneCheck.value = null
    return
  }
  if (phoneCheck.value?.phone === phone) return
  let result: PhoneCheck | null = null
  if (navigator.onLine) {
    result = await $fetch<PhoneCheck>('/api/supporters/check-phone', { query: { phone } }).catch(() => null)
  }
  result ??= await localPhoneCheck(phone)
  // Ignore a late answer for a number the lead has since changed.
  if (result && normalizePhone(state.phone) === phone) phoneCheck.value = { phone, result }
}
watch(() => state.phone, (value) => {
  if (phoneCheck.value && normalizePhone(value) !== phoneCheck.value.phone) phoneCheck.value = null
})

const phoneNotice = computed(() => {
  const check = phoneCheck.value?.result
  if (!check || check.countInSystem === 0) return null
  const n = check.countInSystem
  if (check.limitReached) return { color: 'error' as const, text: t('capture.errors.phone_limit') }
  if (check.samePu) return { color: 'warning' as const, text: t('capture.phoneCheck.samePu', { count: n }, n) }
  return { color: 'warning' as const, text: t('capture.phoneCheck.elsewhere', { count: n }, n) }
})

const sync = useSync()
const REJECT_KEYS = new Set(['invalid', 'no_consent', 'out_of_scope', 'pu_inactive', 'phone_limit'])

function clearForm() {
  savedThisSession.value++
  Object.assign(state, blank())
  consentAt.value = null
  phoneCheck.value = null
  form.value?.clear()
  focusName()
}

async function onSubmit(event: FormSubmitEvent<SupporterFormOutput>) {
  if (!unit.value) return
  saving.value = true
  saveError.value = null
  const { consentGiven: _consent, ...fields } = event.data
  const now = new Date().toISOString()
  const item: SupporterInput = {
    ...fields,
    id: newId(),
    puCode: unit.value.code,
    consentAt: consentAt.value ?? now,
    consentVersion: consentVersion.value,
    consentLanguage: consentLanguage.value,
    gps: gps.current(),
    capturedAt: now,
    deviceId: getDeviceId(),
  }
  try {
    try {
      await saveCapture(item)
    }
    catch {
      saveError.value = 'capture.errors.deviceStorage'
      return
    }
    // Online: send now (the backoff is ignored, the pull waits for the next run). Offline, or if this push gets no
    // answer: the service worker sends it once the connection is back (Background Sync), or the next engine run does.
    const report = await sync.run({ force: true, pull: false })
    if (!report || report.pushError !== undefined) void requestBackgroundSync()
    const mine = report?.results.find(r => r.id === item.id)
    if (mine?.result === 'rejected' || mine?.result === 'conflict') {
      // Refused while the lead is still with the supporter: keep the form so they can fix it and save again.
      await discardCapture(item.id)
      saveError.value = mine.result === 'rejected' && REJECT_KEYS.has(mine.reason) ? `capture.errors.${mine.reason}` : 'capture.errors.conflict'
      return
    }
    await finishFix()
    const onServer = mine?.result === 'accepted' || mine?.result === 'duplicate'
    toast.add({
      title: t(onServer ? 'capture.saved' : 'capture.savedLocal'),
      color: 'success',
      icon: onServer ? 'i-lucide-check' : 'i-lucide-smartphone',
    })
    // Captures saved earlier (offline) that this push got refused: the Sync screen (4.4) lists them.
    const earlier = report?.results.filter(r => r.id !== item.id && (r.result === 'rejected' || r.result === 'conflict')).length ?? 0
    if (earlier) toast.add({ title: t('capture.rejectedLater', { count: earlier }, earlier), color: 'warning', icon: 'i-lucide-triangle-alert' })
    clearForm()
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <UAlert
      v-if="role && !isPuLead"
      color="warning"
      variant="subtle"
      :title="t('capture.notAllowed')"
    />

    <template v-else-if="unit">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-bold">
          {{ t('capture.title') }}
        </h1>
        <p
          class="text-muted"
          data-testid="capture-pu"
        >
          {{ t('capture.pu', { code: unit.code, name: unit.name }) }}
        </p>
      </div>

      <UAlert
        v-if="fixId || fixGone"
        :color="fixId ? 'warning' : 'neutral'"
        variant="subtle"
        icon="i-lucide-pencil"
        :title="t(fixId ? 'sync.fixing' : 'sync.fixGone')"
        data-testid="capture-fixing"
      />

      <UForm
        ref="form"
        :schema="supporterFormSchema"
        :state="formState"
        :validate-on="['blur']"
        :disabled="!mounted || saving"
        class="flex flex-col gap-5"
        novalidate
        data-testid="capture-form"
        @submit="onSubmit"
        @error="onError"
      >
        <p class="text-sm text-muted">
          {{ t('capture.requiredNote') }}
        </p>

        <UFormField
          :label="t('supporter.fields.fullName')"
          name="fullName"
          :data-capture-field="'fullName'"
          size="xl"
          required
        >
          <UInput
            ref="nameInput"
            v-model="state.fullName"
            autocomplete="off"
            enterkeyhint="next"
            class="w-full"
            size="xl"
            data-testid="capture-name"
          />
          <template #error="{ error }">
            {{ typeof error === 'string' ? t(error) : '' }}
          </template>
        </UFormField>

        <UFormField
          :label="t('supporter.fields.phone')"
          name="phone"
          :data-capture-field="'phone'"
          size="xl"
          required
        >
          <UInput
            v-model="state.phone"
            type="tel"
            inputmode="tel"
            autocomplete="off"
            class="w-full"
            size="xl"
            data-testid="capture-phone"
            @blur="checkPhoneNumber"
          />
          <p
            v-if="phoneNotice"
            role="status"
            class="mt-2 flex items-start gap-2 text-base text-highlighted"
            data-testid="capture-phone-notice"
          >
            <!-- Only the icon is coloured: amber/red text on white would fail WCAG contrast in sunlight. -->
            <UIcon
              :name="phoneNotice.color === 'error' ? 'i-lucide-circle-alert' : 'i-lucide-triangle-alert'"
              class="mt-0.5 size-5 shrink-0"
              :class="phoneNotice.color === 'error' ? 'text-error' : 'text-warning'"
              aria-hidden="true"
            />
            {{ phoneNotice.text }}
          </p>
          <template #error="{ error }">
            {{ typeof error === 'string' ? t(error) : '' }}
          </template>
        </UFormField>

        <UCheckbox
          v-model="state.sharedPhone"
          :label="t('supporter.fields.sharedPhone')"
          :description="t('capture.sharedPhoneHelp')"
          size="xl"
          data-testid="capture-shared-phone"
        />

        <UFormField
          :label="t('supporter.fields.address')"
          :help="t('capture.addressHelp')"
          name="address"
          :data-capture-field="'address'"
          size="xl"
        >
          <UInput
            v-model="state.address"
            autocomplete="off"
            class="w-full"
            size="xl"
            data-testid="capture-address"
          />
          <template #error="{ error }">
            {{ typeof error === 'string' ? t(error) : '' }}
          </template>
        </UFormField>

        <UFormField
          name="gender"
          :data-capture-field="'gender'"
        >
          <SupporterChoiceGroup
            v-model="state.gender"
            :legend="t('supporter.fields.gender')"
            :items="genderItems"
            data-testid="capture-gender"
          />
        </UFormField>

        <UFormField
          name="ageBand"
          :data-capture-field="'ageBand'"
        >
          <SupporterChoiceGroup
            v-model="state.ageBand"
            :legend="t('supporter.fields.ageBand')"
            :items="ageItems"
            data-testid="capture-age"
          />
        </UFormField>

        <UFormField
          name="supportLevel"
          :data-capture-field="'supportLevel'"
        >
          <SupporterChoiceGroup
            v-model="state.supportLevel"
            :legend="t('supporter.fields.supportLevel')"
            :items="supportItems"
            required
            data-testid="capture-support"
          />
          <template #error="{ error }">
            {{ typeof error === 'string' ? t(error) : '' }}
          </template>
        </UFormField>

        <UFormField
          name="hasPvc"
          :data-capture-field="'hasPvc'"
        >
          <SupporterChoiceGroup
            v-model="state.hasPvc"
            :legend="t('supporter.fields.hasPvc')"
            :items="pvcItems"
            required
            data-testid="capture-pvc"
          />
          <template #error="{ error }">
            {{ typeof error === 'string' ? t(error) : '' }}
          </template>
        </UFormField>

        <UCheckbox
          v-model="state.volunteer"
          :label="t('supporter.fields.volunteer')"
          size="xl"
          data-testid="capture-volunteer"
        />

        <section class="flex flex-col gap-3 rounded-2xl border border-default bg-default p-4">
          <details
            class="group"
            data-testid="capture-consent-script"
          >
            <summary class="flex min-h-12 cursor-pointer items-center gap-2 font-semibold text-primary focus-visible:outline-2 focus-visible:outline-primary">
              <UIcon
                name="i-lucide-chevron-right"
                class="size-5 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                aria-hidden="true"
              />
              {{ t('capture.consentRead') }}
            </summary>
            <div class="mt-3 flex flex-col gap-3">
              <div
                class="flex gap-2"
                role="group"
                :aria-label="t('capture.consentLanguage')"
              >
                <UButton
                  v-for="lang in (['ha', 'en'] as const)"
                  :key="lang"
                  class="min-h-12"
                  :variant="consentLanguage === lang ? 'solid' : 'outline'"
                  :aria-pressed="consentLanguage === lang"
                  :label="t(`capture.consentLanguageName.${lang}`)"
                  @click="consentLanguage = lang"
                />
              </div>
              <p
                :lang="consentLanguage"
                class="text-lg leading-relaxed"
                data-testid="capture-consent-text"
              >
                {{ script }}
              </p>
            </div>
          </details>

          <UFormField
            name="consentGiven"
            :data-capture-field="'consentGiven'"
          >
            <UCheckbox
              v-model="state.consentGiven"
              :label="t('capture.consentAgree')"
              size="xl"
              required
              data-testid="capture-consent"
            />
            <template #error="{ error }">
              {{ typeof error === 'string' ? t(error) : '' }}
            </template>
          </UFormField>
        </section>

        <UAlert
          v-if="saveError"
          color="error"
          variant="subtle"
          role="alert"
          :title="t(saveError)"
          data-testid="capture-error"
        />

        <div class="sticky bottom-20 z-10 -mx-4 flex flex-col gap-2 border-t border-default bg-default px-4 py-3 md:bottom-0">
          <UButton
            type="submit"
            size="xl"
            block
            class="min-h-14 text-lg"
            :loading="saving"
            :disabled="!mounted"
            :label="t('capture.save')"
            data-testid="capture-submit"
          />
          <div class="flex items-center justify-between gap-2 text-sm text-muted">
            <span
              role="status"
              data-testid="capture-count"
            >{{ t('capture.sessionCount', { count: savedThisSession }) }}</span>
            <span
              class="flex items-center gap-1"
              data-testid="capture-gps"
            >
              <UIcon
                :name="gps.status.value === 'ok' ? 'i-lucide-map-pin' : 'i-lucide-map-pin-off'"
                class="size-4"
                aria-hidden="true"
              />
              {{ gpsLabel }}
            </span>
          </div>
        </div>
      </UForm>
    </template>
  </div>
</template>
