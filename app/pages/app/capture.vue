<script setup lang="ts">
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import { AGE_BANDS, GENDERS, HAS_PVC, SUPPORT_LEVELS, type AgeBand, type ConsentLanguage, type Gender, type HasPvc, type SupportLevel } from '~~/shared/constants/enums'
import { CURRENT_CONSENT_VERSION, consentScript } from '~~/shared/constants/consent'
import { supporterFormSchema, type SupporterForm, type SupporterFormOutput } from '~~/shared/schemas/supporter'
import type { SupporterInput, SyncItemResult } from '~~/shared/types/supporter'
import { newId } from '~~/shared/utils/uuid'

// Add supporter (UX §4.1, PRD US-4…US-7). One scroll, a big Save, only name/phone/support/PVC/consent required.
// Phase 3 saves online through /api/sync/push; 4.2 moves this to local-first (Dexie + outbox).
definePageMeta({ layout: 'app', titleKey: 'nav.capture' })

const { t, locale } = useI18n()
const toast = useToast()
const config = useRuntimeConfig()
const gps = useSilentGps()

const { data: me } = await useFetch('/api/auth/me', { key: 'me' })
const unit = computed(() => me.value?.unit ?? null)
const isPuLead = computed(() => me.value?.user.role === 'PU_LEAD')

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

const options = <T extends string>(values: readonly T[], prefix: string) =>
  computed(() => values.map(value => ({ value, label: t(`${prefix}.${value}`) })))
const genderItems = options(GENDERS, 'supporter.gender')
const ageItems = options(AGE_BANDS, 'supporter.ageBand')
const supportItems = options(SUPPORT_LEVELS, 'supporter.supportLevel')
const pvcItems = options(HAS_PVC, 'supporter.hasPvc')

const form = useTemplateRef('form')
const nameInput = useTemplateRef('nameInput')
const saving = ref(false)
const saveError = ref<string | null>(null)
const savedThisSession = useState('capture:savedThisSession', () => 0)

const chipUi = { fieldset: 'flex flex-wrap gap-2', item: 'min-h-12 rounded-xl px-4 has-data-[state=checked]:bg-millet-500 has-data-[state=checked]:text-ink' }

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

const REJECT_KEYS = new Set(['invalid', 'no_consent', 'out_of_scope', 'pu_inactive'])

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
    const { results } = await $fetch<{ results: SyncItemResult[] }>('/api/sync/push', { method: 'POST', body: { items: [item] } })
    const result = results[0]
    if (result?.result === 'accepted' || result?.result === 'duplicate') {
      savedThisSession.value++
      toast.add({ title: t('capture.saved'), color: 'success', icon: 'i-lucide-check' })
      Object.assign(state, blank())
      consentAt.value = null
      form.value?.clear()
      focusName()
    }
    else if (result?.result === 'rejected' && REJECT_KEYS.has(result.reason)) {
      saveError.value = `capture.errors.${result.reason}`
    }
    else {
      saveError.value = 'capture.errors.conflict'
    }
  }
  catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    saveError.value = !status ? 'capture.errors.network' : status === 429 ? 'capture.errors.rate_limited' : status === 403 ? 'capture.errors.not_allowed' : 'capture.errors.unknown'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <UAlert
      v-if="me && !isPuLead"
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
          />
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
          <URadioGroup
            v-model="state.gender"
            :legend="t('supporter.fields.gender')"
            :aria-label="t('supporter.fields.gender')"
            :items="genderItems"
            orientation="horizontal"
            variant="table"
            indicator="hidden"
            size="xl"
            :ui="chipUi"
            data-testid="capture-gender"
          />
        </UFormField>

        <UFormField
          name="ageBand"
          :data-capture-field="'ageBand'"
        >
          <URadioGroup
            v-model="state.ageBand"
            :legend="t('supporter.fields.ageBand')"
            :aria-label="t('supporter.fields.ageBand')"
            :items="ageItems"
            orientation="horizontal"
            variant="table"
            indicator="hidden"
            size="xl"
            :ui="chipUi"
            data-testid="capture-age"
          />
        </UFormField>

        <UFormField
          name="supportLevel"
          :data-capture-field="'supportLevel'"
        >
          <URadioGroup
            v-model="state.supportLevel"
            :legend="t('supporter.fields.supportLevel')"
            :aria-label="t('supporter.fields.supportLevel')"
            :items="supportItems"
            orientation="horizontal"
            variant="table"
            indicator="hidden"
            size="xl"
            required
            :ui="chipUi"
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
          <URadioGroup
            v-model="state.hasPvc"
            :legend="t('supporter.fields.hasPvc')"
            :aria-label="t('supporter.fields.hasPvc')"
            :items="pvcItems"
            orientation="horizontal"
            variant="table"
            indicator="hidden"
            size="xl"
            required
            :ui="chipUi"
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
