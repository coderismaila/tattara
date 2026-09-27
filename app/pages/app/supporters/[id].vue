<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { AgeBand, Gender, HasPvc, SupportLevel } from '~~/shared/constants/enums'
import { removalRequestSchema, supporterFieldsSchema, type SupporterFields } from '~~/shared/schemas/supporter'
import { SUPPORTER_EDITABLE_FIELDS, type MaskedSupporterDto, type SupporterDto } from '~~/shared/types/supporter'

// Supporter detail (US-8): PU lead views and edits; ward lead views. Either may request removal (no hard delete).
definePageMeta({ layout: 'app', titleKey: 'nav.supporters' })

const { t, locale } = useI18n()
const toast = useToast()
const route = useRoute()
const id = computed(() => String(route.params.id))

const { data, error, refresh } = await useFetch<{ supporter: SupporterDto | MaskedSupporterDto, canEdit: boolean }>(
  () => `/api/supporters/${id.value}`,
  { key: `supporter-${id.value}` },
)
const notFound = computed(() => !!error.value)
const supporter = computed(() => (data.value?.supporter && !data.value.supporter.masked ? data.value.supporter : null))
const canEdit = computed(() => !!data.value?.canEdit && supporter.value?.status === 'active')

const mounted = ref(false)
onMounted(() => (mounted.value = true))

const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value === 'ha' ? 'ha-NG' : 'en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Lagos',
}))

const { genderItems, ageItems, supportItems, pvcItems } = useSupporterOptions()

// ── Edit ────────────────────────────────────────────────────────────────────
interface EditState {
  fullName: string
  phone: string
  address: string
  gender?: Gender
  ageBand?: AgeBand
  supportLevel?: SupportLevel
  hasPvc?: HasPvc
  volunteer: boolean
  sharedPhone: boolean
}
const editing = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)
const edit = reactive<EditState>({ fullName: '', phone: '', address: '', volunteer: false, sharedPhone: false })
const formState = edit as unknown as Partial<SupporterFields>

function startEdit() {
  const s = supporter.value!
  Object.assign(edit, {
    fullName: s.fullName,
    phone: s.phone ?? '',
    address: s.address ?? '',
    gender: s.gender ?? undefined,
    ageBand: s.ageBand ?? undefined,
    supportLevel: s.supportLevel,
    hasPvc: s.hasPvc,
    volunteer: s.volunteer,
    sharedPhone: s.sharedPhone,
  })
  saveError.value = null
  editing.value = true
}

async function saveEdit(event: FormSubmitEvent<SupporterFields>) {
  const before = supporter.value!
  // Send only what changed (PATCH semantics; the audit log records the changed field names).
  const patch = Object.fromEntries(SUPPORTER_EDITABLE_FIELDS
    .filter(f => event.data[f] !== before[f])
    .map(f => [f, event.data[f]]))
  if (Object.keys(patch).length === 0) {
    editing.value = false
    return
  }
  saving.value = true
  saveError.value = null
  try {
    await $fetch(`/api/supporters/${id.value}`, { method: 'PATCH', body: patch })
    toast.add({ title: t('supporterDetail.saved'), color: 'success', icon: 'i-lucide-check' })
    editing.value = false
    await refresh()
  }
  catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    saveError.value = !status ? 'capture.errors.network' : status === 404 ? 'supporterDetail.notFound' : 'capture.errors.invalid'
  }
  finally {
    saving.value = false
  }
}

// ── Removal request ─────────────────────────────────────────────────────────
const removalOpen = ref(false)
const reason = ref('')
const removalError = ref<string | null>(null)
const removing = ref(false)

function openRemoval() {
  reason.value = ''
  removalError.value = null
  removalOpen.value = true
}

async function submitRemoval() {
  const parsed = removalRequestSchema.safeParse({ reason: reason.value })
  if (!parsed.success) {
    removalError.value = parsed.error.issues[0]!.message
    return
  }
  removing.value = true
  removalError.value = null
  try {
    await $fetch(`/api/supporters/${id.value}/removal`, { method: 'POST', body: parsed.data })
    toast.add({ title: t('supporterDetail.removalRequested'), color: 'success' })
    removalOpen.value = false
    await refresh()
  }
  catch (e) {
    const err = e as { statusCode?: number, data?: { data?: { reason?: string, issues?: { message: string }[] } } }
    removalError.value = err.data?.data?.issues?.[0]?.message
      ?? (err.data?.data?.reason === 'already_requested' ? 'supporterDetail.alreadyRequested' : err.statusCode ? 'capture.errors.unknown' : 'capture.errors.network')
  }
  finally {
    removing.value = false
  }
}

const rowsFor = (s: SupporterDto) => [
  { label: t('supporter.fields.phone'), value: s.phone ?? '—', tabular: true },
  { label: t('supporter.fields.sharedPhone'), value: t(s.sharedPhone ? 'supporterDetail.yes' : 'supporterDetail.no') },
  { label: t('supporter.fields.address'), value: s.address ?? '—' },
  { label: t('supporter.fields.gender'), value: s.gender ? t(`supporter.gender.${s.gender}`) : '—' },
  { label: t('supporter.fields.ageBand'), value: s.ageBand ? t(`supporter.ageBand.${s.ageBand}`) : '—' },
  { label: t('supporter.fields.supportLevel'), value: t(`supporter.supportLevel.${s.supportLevel}`) },
  { label: t('supporter.fields.hasPvc'), value: t(`supporter.hasPvc.${s.hasPvc}`) },
  { label: t('supporter.fields.volunteer'), value: t(s.volunteer ? 'supporterDetail.yes' : 'supporterDetail.no') },
  { label: t('supporterDetail.pu'), value: s.puCode, tabular: true },
  { label: t('supporterDetail.added'), value: dateFormat.value.format(new Date(s.capturedAt)) },
  { label: t('supporterDetail.verification'), value: t(`supporter.verification.${s.verification}`) },
]
</script>

<template>
  <div class="flex flex-col gap-4">
    <NuxtLink
      to="/app/supporters"
      class="flex min-h-12 items-center gap-1 self-start font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary"
    >
      <UIcon
        name="i-lucide-arrow-left"
        class="size-5"
        aria-hidden="true"
      />
      {{ t('supporterDetail.back') }}
    </NuxtLink>

    <UAlert
      v-if="notFound"
      color="warning"
      variant="subtle"
      :title="t('supporterDetail.notFound')"
    />

    <template v-else-if="supporter">
      <div class="flex items-start justify-between gap-3">
        <h1
          class="text-2xl font-bold"
          data-testid="supporter-name"
        >
          {{ supporter.fullName }}
        </h1>
        <UBadge
          v-if="supporter.status === 'removal_requested'"
          color="warning"
          variant="subtle"
          size="lg"
          data-testid="supporter-status"
        >
          {{ t('supporter.status.removal_requested') }}
        </UBadge>
      </div>

      <dl
        v-if="!editing"
        class="grid grid-cols-1 gap-x-4 gap-y-3 rounded-lg border border-default bg-default p-4 sm:grid-cols-[max-content_1fr]"
        data-testid="supporter-details"
      >
        <template
          v-for="row in rowsFor(supporter)"
          :key="row.label"
        >
          <dt class="text-sm text-muted">
            {{ row.label }}
          </dt>
          <dd
            class="font-medium"
            :class="{ tabular: row.tabular }"
          >
            {{ row.value }}
          </dd>
        </template>
      </dl>

      <UForm
        v-else
        :schema="supporterFieldsSchema"
        :state="formState"
        :disabled="!mounted || saving"
        class="flex flex-col gap-5"
        novalidate
        data-testid="supporter-edit"
        @submit="saveEdit"
      >
        <UFormField
          :label="t('supporter.fields.fullName')"
          name="fullName"
          size="xl"
          required
        >
          <UInput
            v-model="edit.fullName"
            autocomplete="off"
            class="w-full"
            size="xl"
            data-testid="edit-name"
          />
          <template #error="{ error: e }">
            {{ typeof e === 'string' ? t(e) : '' }}
          </template>
        </UFormField>
        <UFormField
          :label="t('supporter.fields.phone')"
          name="phone"
          size="xl"
          required
        >
          <UInput
            v-model="edit.phone"
            type="tel"
            inputmode="tel"
            autocomplete="off"
            class="w-full"
            size="xl"
            data-testid="edit-phone"
          />
          <template #error="{ error: e }">
            {{ typeof e === 'string' ? t(e) : '' }}
          </template>
        </UFormField>
        <UCheckbox
          v-model="edit.sharedPhone"
          :label="t('supporter.fields.sharedPhone')"
          size="xl"
        />
        <UFormField
          :label="t('supporter.fields.address')"
          name="address"
          size="xl"
        >
          <UInput
            v-model="edit.address"
            autocomplete="off"
            class="w-full"
            size="xl"
          />
          <template #error="{ error: e }">
            {{ typeof e === 'string' ? t(e) : '' }}
          </template>
        </UFormField>
        <UFormField name="gender">
          <SupporterChoiceGroup
            v-model="edit.gender"
            :legend="t('supporter.fields.gender')"
            :items="genderItems"
          />
        </UFormField>
        <UFormField name="ageBand">
          <SupporterChoiceGroup
            v-model="edit.ageBand"
            :legend="t('supporter.fields.ageBand')"
            :items="ageItems"
          />
        </UFormField>
        <UFormField name="supportLevel">
          <SupporterChoiceGroup
            v-model="edit.supportLevel"
            :legend="t('supporter.fields.supportLevel')"
            :items="supportItems"
            required
            data-testid="edit-support"
          />
        </UFormField>
        <UFormField name="hasPvc">
          <SupporterChoiceGroup
            v-model="edit.hasPvc"
            :legend="t('supporter.fields.hasPvc')"
            :items="pvcItems"
            required
          />
        </UFormField>
        <UCheckbox
          v-model="edit.volunteer"
          :label="t('supporter.fields.volunteer')"
          size="xl"
        />
        <UAlert
          v-if="saveError"
          color="error"
          variant="subtle"
          role="alert"
          :title="t(saveError)"
        />
        <div class="flex flex-wrap gap-2">
          <UButton
            type="submit"
            size="xl"
            class="min-h-12"
            :loading="saving"
            :label="t('supporterDetail.save')"
            data-testid="edit-save"
          />
          <UButton
            size="xl"
            variant="ghost"
            color="neutral"
            class="min-h-12"
            :label="t('supporterDetail.cancel')"
            @click="editing = false"
          />
        </div>
      </UForm>

      <div
        v-if="!editing"
        class="flex flex-wrap gap-2"
      >
        <UButton
          v-if="canEdit"
          size="xl"
          class="min-h-12"
          icon="i-lucide-pencil"
          :disabled="!mounted"
          :label="t('supporterDetail.edit')"
          data-testid="supporter-edit-open"
          @click="startEdit"
        />
        <UButton
          v-if="supporter.status === 'active'"
          size="xl"
          variant="outline"
          color="error"
          class="min-h-12"
          :disabled="!mounted"
          :label="t('supporterDetail.requestRemoval')"
          data-testid="supporter-removal-open"
          @click="openRemoval"
        />
      </div>
    </template>

    <UModal
      v-model:open="removalOpen"
      :title="t('supporterDetail.removalTitle')"
    >
      <template #body>
        <form
          class="flex flex-col gap-4"
          novalidate
          @submit.prevent="submitRemoval"
        >
          <p>{{ t('supporterDetail.removalIntro') }}</p>
          <UFormField
            :label="t('team.reason')"
            :help="t('team.reasonHelp')"
            name="reason"
            size="xl"
          >
            <UTextarea
              v-model="reason"
              :rows="3"
              class="w-full"
              size="xl"
              data-testid="removal-reason"
            />
          </UFormField>
          <UAlert
            v-if="removalError"
            color="error"
            variant="subtle"
            role="alert"
            :title="t(removalError)"
          />
          <UButton
            type="submit"
            color="error"
            size="xl"
            block
            class="min-h-12"
            :loading="removing"
            :label="t('supporterDetail.confirmRemoval')"
            data-testid="removal-submit"
          />
        </form>
      </template>
    </UModal>
  </div>
</template>
