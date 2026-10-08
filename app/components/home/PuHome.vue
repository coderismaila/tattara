<script setup lang="ts">
// The PU lead's home (task 6.2, UX §4.2): today's captures, total against the target, what's waiting to send, and Add
// supporter. Works offline: today's count and the queue come from the phone, the totals from the last online visit.
import { countCapturedToday, getHomeStats, saveHomeStats, type HomeStatsSnapshot } from '~/offline/home'
import { captureCounts } from '~/offline/outbox'
import type { UnitStats } from '~~/shared/types/stats'
import { toUrlCode } from '~~/shared/utils/pu-code'

const props = defineProps<{ puCode: string }>()
const { t, n, locale } = useI18n()
const online = useOnline()

const today = useLiveQuery(() => countCapturedToday(props.puCode), 0)
const queue = useLiveQuery(captureCounts, { pending: 0, rejected: 0 })

// Online: fresh numbers, remembered for offline. Offline (or if the request fails): the remembered ones.
const snapshot = ref<HomeStatsSnapshot | null>(null)
const fromCache = ref(false)
async function load() {
  try {
    if (!navigator.onLine) throw new Error('offline')
    const s = await $fetch<UnitStats>(`/api/stats/unit/${toUrlCode(props.puCode)}`)
    // A plain object: IndexedDB can't clone Vue's reactive proxy.
    const fresh: HomeStatsSnapshot = { supporters: s.totals.supporters, verified: s.totals.verified, target: s.target, computedAt: s.computedAt }
    snapshot.value = fresh
    fromCache.value = false
    await saveHomeStats(fresh).catch(() => {})
  }
  catch {
    snapshot.value = (await getHomeStats().catch(() => undefined)) ?? null
    fromCache.value = true
  }
}
onMounted(load)
watch(online, (now) => {
  if (now) void load()
})

const when = computed(() => snapshot.value
  ? new Intl.DateTimeFormat(locale.value === 'ha' ? 'ha-NG' : 'en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(snapshot.value.computedAt))
  : '')
const ringLabel = computed(() => {
  const s = snapshot.value
  if (!s?.target) return t('dashboard.noTarget')
  return t('dashboard.progressLabel', { value: n(s.supporters), target: n(s.target) })
})
</script>

<template>
  <section
    aria-labelledby="pu-home-heading"
    class="flex flex-col gap-4"
  >
    <h2
      id="pu-home-heading"
      class="sr-only"
    >
      {{ t('dashboard.myPu') }}
    </h2>

    <UButton
      to="/app/capture"
      size="xl"
      icon="i-lucide-user-plus"
      class="min-h-14 justify-center text-lg"
      :label="t('nav.capture')"
      data-testid="home-add"
    />

    <div class="grid grid-cols-2 gap-3">
      <div class="flex flex-col gap-1 rounded-lg border border-default bg-default p-4">
        <span class="text-sm text-muted">{{ t('dashboard.today') }}</span>
        <span
          class="tabular text-3xl font-bold"
          data-testid="home-today"
        >{{ n(today) }}</span>
      </div>
      <NuxtLink
        to="/app/sync"
        class="flex flex-col gap-1 rounded-lg border border-default bg-default p-4 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span class="text-sm text-muted">{{ t('dashboard.waiting') }}</span>
        <span
          class="tabular text-3xl font-bold"
          data-testid="home-pending"
        >{{ n(queue.pending) }}</span>
        <span
          v-if="queue.rejected"
          class="text-sm text-highlighted"
        >
          <UIcon
            name="i-lucide-triangle-alert"
            class="me-1 size-4 align-[-2px] text-warning"
            aria-hidden="true"
          />{{ t('sync.pill.rejected', { count: queue.rejected }, queue.rejected) }}
        </span>
      </NuxtLink>
    </div>

    <div
      class="flex items-center gap-4 rounded-lg border border-default bg-default p-4"
      data-testid="home-total"
    >
      <ChartsProgressRing
        :value="snapshot?.supporters ?? 0"
        :target="snapshot?.target ?? null"
        :label="ringLabel"
      />
      <div class="flex min-w-0 flex-col gap-1">
        <span class="text-sm text-muted">{{ t('dashboard.total') }}</span>
        <span
          class="tabular text-3xl font-bold"
          data-testid="home-total-value"
        >{{ snapshot ? n(snapshot.supporters) : '—' }}</span>
        <span class="text-sm text-muted">
          {{ snapshot?.target ? t('dashboard.ofTarget', { target: n(snapshot.target) }) : t('dashboard.noTarget') }}
        </span>
        <span
          v-if="snapshot && fromCache"
          class="text-sm text-muted"
          data-testid="home-cached"
        >{{ t('dashboard.asOf', { time: when }) }}</span>
      </div>
    </div>
  </section>
</template>
