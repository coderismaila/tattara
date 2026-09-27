<script setup lang="ts">
import type { MaskedSupporterDto, SupporterDto } from '~~/shared/types/supporter'

// Supporter list + search (US-8): PU lead sees their PU, ward lead their ward (optionally one PU). Newest first.
definePageMeta({ layout: 'app', titleKey: 'nav.supporters' })

const { t } = useI18n()

const { data: me } = await useFetch('/api/auth/me', { key: 'me' })
const isWardLead = computed(() => me.value?.user.role === 'WARD_LEAD')

/** Select items can't use '' as a value (Reka UI). */
const ALL_PUS = 'all'

// Ward lead: the ward's PUs for the filter (the team list has them with their names).
const { data: team } = await useFetch('/api/team', { key: 'team', immediate: isWardLead.value })
const puItems = computed(() => [
  { value: ALL_PUS, label: t('supporters.allPus') },
  ...(team.value?.members ?? []).map(m => ({ value: m.code, label: `${m.code} · ${m.name}` })),
])

const search = ref('')
const q = ref('')
let debounce: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(debounce)
  debounce = setTimeout(() => (q.value = value.trim()), 300)
})
const pu = ref(ALL_PUS)

type Row = SupporterDto | MaskedSupporterDto
interface Page { items: Row[], nextCursor: string | null }

const query = computed(() => ({ q: q.value || undefined, pu: pu.value === ALL_PUS ? undefined : pu.value }))
const { data, error, status } = await useFetch<Page>('/api/supporters', { key: 'supporters', query })
const forbidden = computed(() => error.value?.statusCode === 403)

// Later pages are appended locally; a new search starts over.
const extra = ref<Row[]>([])
const cursor = ref<string | null>(null)
watch(data, (page) => {
  extra.value = []
  cursor.value = page?.nextCursor ?? null
}, { immediate: true })
const rows = computed(() => [...(data.value?.items ?? []), ...extra.value])

const loadingMore = ref(false)
async function showMore() {
  if (!cursor.value) return
  loadingMore.value = true
  try {
    const page = await $fetch<Page>('/api/supporters', { query: { ...query.value, cursor: cursor.value } })
    extra.value.push(...page.items)
    cursor.value = page.nextCursor
  }
  finally {
    loadingMore.value = false
  }
}

const SUPPORT_COLOR = { strong: 'success', leaning: 'info', undecided: 'neutral' } as const
const displayName = (row: Row) => (row.masked ? row.initials : row.fullName)
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-2xl font-bold">
      {{ t('supporters.title') }}
    </h1>

    <UAlert
      v-if="forbidden"
      color="warning"
      variant="subtle"
      :title="t('supporters.notAllowed')"
    />

    <template v-else>
      <div class="flex flex-col gap-3 md:flex-row">
        <UFormField
          :label="t('supporters.search')"
          :help="t('supporters.searchHelp')"
          name="q"
          size="xl"
          class="flex-1"
        >
          <UInput
            v-model="search"
            type="search"
            icon="i-lucide-search"
            autocomplete="off"
            class="w-full"
            size="xl"
            data-testid="supporters-search"
          />
        </UFormField>
        <UFormField
          v-if="isWardLead"
          :label="t('supporters.puFilter')"
          name="pu"
          size="xl"
          class="md:w-80"
        >
          <USelect
            v-model="pu"
            :items="puItems"
            class="w-full"
            size="xl"
            data-testid="supporters-pu"
          />
        </UFormField>
      </div>

      <p
        v-if="status !== 'pending' && rows.length === 0"
        class="text-muted"
        role="status"
      >
        {{ q ? t('supporters.noResults') : t('supporters.empty') }}
      </p>

      <ul
        v-else
        class="flex flex-col gap-2"
        data-testid="supporters-list"
      >
        <li
          v-for="row in rows"
          :key="row.id"
        >
          <NuxtLink
            :to="`/app/supporters/${row.id}`"
            class="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-default bg-default p-3 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-semibold">{{ displayName(row) }}</span>
              <span class="tabular text-sm text-muted">{{ row.phone ?? '—' }}<template v-if="isWardLead"> · {{ row.puCode }}</template></span>
            </span>
            <span class="flex shrink-0 flex-wrap justify-end gap-1">
              <UBadge
                v-if="row.status === 'removal_requested'"
                color="warning"
                variant="subtle"
              >
                {{ t('supporter.status.removal_requested') }}
              </UBadge>
              <UBadge
                v-if="!row.masked"
                :color="SUPPORT_COLOR[row.supportLevel]"
                variant="subtle"
              >
                {{ t(`supporter.supportLevel.${row.supportLevel}`) }}
              </UBadge>
            </span>
          </NuxtLink>
        </li>
      </ul>

      <UButton
        v-if="cursor"
        class="min-h-12 self-center"
        variant="outline"
        :loading="loadingMore"
        :label="t('supporters.showMore')"
        data-testid="supporters-more"
        @click="showMore"
      />
    </template>
  </div>
</template>
