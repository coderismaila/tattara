<script setup lang="ts">
// Flags to review (task 5.4, SECURITY_PRIVACY §3): open or reviewed, filtered by type, newest first. Ward leads see
// the supporter in full, LGA leads and above masked. Dismiss or confirm with an optional note; a reviewed flag can
// be reviewed again (overruled).
import { FLAG_TYPES, type FlagType } from '~~/shared/constants/enums'
import { flagResolveSchema } from '~~/shared/schemas/flags'
import type { FlagDto, FlagListResponse } from '~~/shared/types/flags'

const { t, locale } = useI18n()
const toast = useToast()

const status = ref<'open' | 'reviewed'>('open')
const type = ref<FlagType | undefined>()
const query = computed(() => ({ status: status.value, type: type.value }))
const { data, error, refresh, status: loadStatus } = await useFetch<FlagListResponse>('/api/flags', { key: 'flags', query })

// "Load more" pages are kept apart and dropped whenever the filters change.
const more = ref<FlagDto[]>([])
const nextCursor = ref<string | null>(null)
watch(data, (d) => {
  more.value = []
  nextCursor.value = d?.nextCursor ?? null
}, { immediate: true })
const items = computed(() => [...(data.value?.items ?? []), ...more.value])
const loadingMore = ref(false)
async function loadMore() {
  if (!nextCursor.value) return
  loadingMore.value = true
  try {
    const page = await $fetch<FlagListResponse>('/api/flags', { query: { ...query.value, cursor: nextCursor.value } })
    more.value.push(...page.items)
    nextCursor.value = page.nextCursor
  }
  finally {
    loadingMore.value = false
  }
}

const statusItems = computed(() => [
  { value: 'open', label: t('flag.open') },
  { value: 'reviewed', label: t('flag.reviewed') },
])
const typeChips = computed(() => FLAG_TYPES.map(value => ({ value, label: t(`flag.types.${value}`), count: data.value?.openCounts[value] ?? 0 })))

const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value === 'ha' ? 'ha-NG' : 'en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Lagos',
}))
const when = (iso: string) => dateFormat.value.format(new Date(iso))

function evidence(flag: FlagDto) {
  const e = flagEvidence(flag.type, flag.details)
  return t(e.key, e.params)
}

function subject(flag: FlagDto): string {
  const s = flag.subject
  if (s.kind === 'supporter') {
    const p = s.supporter
    return p.masked ? t('flag.subject.supporterMasked', { initials: p.initials, phone: p.phone ?? '—' }) : t('flag.subject.supporter', { name: p.fullName, phone: p.phone ?? '—' })
  }
  if (s.kind === 'lead') return s.lead ? t('flag.subject.lead', { name: s.lead.fullName, unit: s.lead.unitCode ?? '—' }) : t('flag.subject.leadGone')
  return t('flag.subject.pu', { pu: flag.puCode })
}

// ── Review dialog ──
const reviewing = ref<{ flag: FlagDto, status: 'dismissed' | 'confirmed' } | null>(null)
const dialogOpen = computed({
  get: () => reviewing.value !== null,
  set: (v: boolean) => {
    if (!v) reviewing.value = null
  },
})
const note = ref('')
const saving = ref(false)
const formError = ref<string | null>(null)

function startReview(flag: FlagDto, decision: 'dismissed' | 'confirmed') {
  note.value = ''
  formError.value = null
  reviewing.value = { flag, status: decision }
}

async function submitReview() {
  if (!reviewing.value) return
  const parsed = flagResolveSchema.safeParse({ status: reviewing.value.status, note: note.value })
  if (!parsed.success) {
    formError.value = parsed.error.issues[0]!.message
    return
  }
  saving.value = true
  try {
    await $fetch(`/api/flags/${reviewing.value.flag.id}/resolve`, { method: 'POST', body: parsed.data })
    toast.add({ title: t(parsed.data.status === 'dismissed' ? 'flag.dismissedToast' : 'flag.confirmedToast'), color: 'success', icon: 'i-lucide-check' })
    reviewing.value = null
    await refresh()
  }
  catch (e) {
    const err = e as { statusCode?: number, data?: { data?: { reason?: string, issues?: { message: string }[] } } }
    const issue = err.data?.data?.issues?.[0]?.message
    formError.value = issue ?? (err.statusCode ? 'flag.errors.unknown' : 'auth.errors.network')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <section
    aria-labelledby="flags-heading"
    class="flex flex-col gap-3"
  >
    <h2
      id="flags-heading"
      class="text-lg font-semibold"
    >
      {{ t('flag.heading') }}
    </h2>

    <UAlert
      v-if="error"
      color="warning"
      variant="subtle"
      icon="i-lucide-cloud-off"
      :title="t('flag.loadFailed')"
    />

    <template v-else>
      <SupporterChoiceGroup
        v-model="status"
        :legend="t('flag.statusLegend')"
        :items="statusItems"
        data-testid="flag-status"
      />

      <div
        class="flex flex-wrap gap-2"
        role="group"
        :aria-label="t('flag.typeLegend')"
      >
        <UButton
          :color="type ? 'neutral' : 'primary'"
          :variant="type ? 'outline' : 'solid'"
          class="min-h-12"
          :aria-pressed="!type"
          :label="t('flag.allTypes')"
          @click="type = undefined"
        />
        <UButton
          v-for="chip in typeChips"
          :key="chip.value"
          :color="type === chip.value ? 'primary' : 'neutral'"
          :variant="type === chip.value ? 'solid' : 'outline'"
          class="min-h-12"
          :aria-pressed="type === chip.value"
          :label="chip.count ? `${chip.label} (${chip.count})` : chip.label"
          :data-testid="`flag-type-${chip.value}`"
          @click="type = chip.value"
        />
      </div>

      <p
        v-if="!items.length && loadStatus !== 'pending'"
        class="rounded-lg border border-default bg-default p-4 text-muted"
        data-testid="flag-none"
      >
        {{ t(status === 'open' ? 'flag.noneOpen' : 'flag.noneReviewed') }}
      </p>

      <ul
        v-else
        class="flex flex-col gap-3"
      >
        <li
          v-for="flag in items"
          :key="flag.id"
          class="flex flex-col gap-2 rounded-lg border border-default bg-default p-4"
          data-testid="flag-item"
        >
          <p class="font-semibold text-highlighted">
            {{ t(`flag.types.${flag.type}`) }}
          </p>
          <p
            class="text-highlighted"
            data-testid="flag-evidence"
          >
            {{ evidence(flag) }}
          </p>
          <p
            class="text-highlighted"
            data-testid="flag-subject"
          >
            {{ subject(flag) }}
          </p>
          <p class="text-sm text-muted">
            {{ t('flag.meta', { pu: flag.puCode, time: when(flag.createdAt) }) }}
          </p>
          <p
            v-if="flag.status !== 'open'"
            class="text-sm text-highlighted"
            data-testid="flag-review"
          >
            {{ t(`flag.status.${flag.status}`) }}<template v-if="flag.reviewedBy">
              · {{ flag.reviewedBy.fullName }}
            </template><template v-if="flag.reviewedAt">
              · {{ when(flag.reviewedAt) }}
            </template><template v-if="flag.reviewNote">
              · “{{ flag.reviewNote }}”
            </template>
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              size="xl"
              color="neutral"
              variant="outline"
              class="min-h-12"
              icon="i-lucide-x"
              :label="t('flag.dismiss')"
              data-testid="flag-dismiss"
              @click="startReview(flag, 'dismissed')"
            />
            <UButton
              size="xl"
              color="neutral"
              variant="outline"
              class="min-h-12"
              icon="i-lucide-check"
              :label="t('flag.confirm')"
              data-testid="flag-confirm"
              @click="startReview(flag, 'confirmed')"
            />
          </div>
        </li>
      </ul>

      <UButton
        v-if="nextCursor"
        color="neutral"
        variant="ghost"
        class="min-h-12 self-start"
        :label="t('flag.loadMore')"
        :loading="loadingMore"
        @click="loadMore"
      />
    </template>

    <UModal
      v-model:open="dialogOpen"
      :title="reviewing ? t(reviewing.status === 'dismissed' ? 'flag.dismissTitle' : 'flag.confirmTitle') : ''"
      :description="reviewing ? t(reviewing.status === 'dismissed' ? 'flag.dismissHelp' : 'flag.confirmHelp') : ''"
    >
      <template #body>
        <UFormField
          :label="t('flag.note')"
          :help="t('flag.noteHelp')"
          size="xl"
        >
          <UInput
            v-model="note"
            class="w-full"
            size="xl"
            maxlength="200"
            autocomplete="off"
            data-testid="flag-note"
          />
        </UFormField>
        <p
          v-if="formError"
          role="alert"
          class="mt-3 text-base text-highlighted"
          data-testid="flag-error"
        >
          <UIcon
            name="i-lucide-circle-alert"
            class="me-1 size-5 align-[-4px] text-error"
            aria-hidden="true"
          />{{ t(formError) }}
        </p>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            size="xl"
            color="neutral"
            variant="outline"
            class="min-h-12"
            :label="t('flag.cancel')"
            @click="reviewing = null"
          />
          <UButton
            size="xl"
            class="min-h-12"
            :loading="saving"
            :label="reviewing ? t(reviewing.status === 'dismissed' ? 'flag.dismiss' : 'flag.confirm') : ''"
            data-testid="flag-submit"
            @click="submitReview"
          />
        </div>
      </template>
    </UModal>
  </section>
</template>
