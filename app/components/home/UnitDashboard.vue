<script setup lang="ts">
// Ward-and-above home (task 6.2, UX §4.2): the unit's summary with a 30-day trend, open flags, and the units below it
// lowest coverage first. Loaded lazily (LazyHomeUnitDashboard), so a PU lead's home never downloads it. Online only:
// leads above PU hold no supporter data offline.
import type { ChildrenStats, UnitStats } from '~~/shared/types/stats'
import { toUrlCode } from '~~/shared/utils/pu-code'

const props = defineProps<{ code: string, canReview: boolean }>()
const { t, n } = useI18n()

const url = computed(() => toUrlCode(props.code))
const { data: stats, error } = await useFetch<UnitStats>(() => `/api/stats/unit/${url.value}`, { key: `home-stats-${url.value}` })
const { data: children } = await useFetch<ChildrenStats>(() => `/api/stats/children/${url.value}`, { key: `home-children-${url.value}` })

const pct = (x: number | null) => (x === null ? '—' : n(x, { style: 'percent', maximumFractionDigits: 0 }))
const verifiedRate = computed(() => (stats.value?.totals.supporters ? stats.value.totals.verified / stats.value.totals.supporters : null))
const trend = computed(() => (stats.value?.last30Days ?? []).map(d => ({ day: d.day, value: d.total })))
const trendText = computed(() => {
  const points = trend.value
  if (points.length < 2) return t('dashboard.trendNone')
  return t('dashboard.trend', { from: n(points[0]!.value), to: n(points.at(-1)!.value), days: points.length })
})
const ringLabel = computed(() => stats.value?.target
  ? t('dashboard.progressLabel', { value: n(stats.value.totals.supporters), target: n(stats.value.target) })
  : t('dashboard.noTarget'))
</script>

<template>
  <div class="flex flex-col gap-6">
    <UAlert
      v-if="error"
      color="warning"
      variant="subtle"
      icon="i-lucide-cloud-off"
      :title="t('dashboard.loadFailed')"
    />

    <template v-else-if="stats">
      <section
        aria-labelledby="unit-summary"
        class="flex flex-col gap-4 rounded-lg border border-default bg-default p-4"
        data-testid="home-summary"
      >
        <h2
          id="unit-summary"
          class="text-lg font-semibold"
        >
          {{ stats.unit.level === 'region' ? t('dashboard.region') : stats.unit.name }}
          <span
            v-if="stats.unit.code"
            class="tabular block text-sm font-normal text-muted"
          >{{ stats.unit.code }}</span>
        </h2>

        <div class="flex flex-wrap items-center gap-6">
          <ChartsProgressRing
            :value="stats.totals.supporters"
            :target="stats.target"
            :label="ringLabel"
          />
          <dl class="grid grid-cols-2 gap-x-6 gap-y-2">
            <div>
              <dt class="text-sm text-muted">
                {{ t('dashboard.supporters') }}
              </dt>
              <dd
                class="tabular text-2xl font-bold"
                data-testid="home-summary-supporters"
              >
                {{ n(stats.totals.supporters) }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-muted">
                {{ t('dashboard.coverage') }}
              </dt>
              <dd
                class="tabular text-2xl font-bold"
                data-testid="home-summary-coverage"
              >
                {{ pct(stats.coverage) }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-muted">
                {{ t('dashboard.verified') }}
              </dt>
              <dd class="tabular text-2xl font-bold">
                {{ pct(verifiedRate) }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-muted">
                {{ t('dashboard.target') }}
              </dt>
              <dd class="tabular text-2xl font-bold">
                {{ stats.target === null ? '—' : n(stats.target) }}
              </dd>
            </div>
          </dl>
        </div>

        <p class="text-sm text-muted">
          {{ t('units.voters.coverage', { reported: n(stats.registeredVoters.pusWithFigure), total: n(stats.registeredVoters.totalPus) }) }}
        </p>

        <div class="flex flex-col gap-1">
          <ChartsTrendLine :points="trend" />
          <p
            class="text-sm text-muted"
            data-testid="home-trend"
          >
            {{ trendText }}
          </p>
        </div>
      </section>

      <NuxtLink
        v-if="props.canReview"
        to="/app/review"
        class="flex items-center justify-between gap-3 rounded-lg border border-default bg-default p-4 focus-visible:outline-2 focus-visible:outline-primary"
        data-testid="home-flags"
      >
        <span class="font-medium text-primary underline">{{ t('dashboard.openFlags') }}</span>
        <span class="tabular text-2xl font-bold">{{ n(stats.totals.flaggedOpen) }}</span>
      </NuxtLink>
      <div
        v-else
        class="flex items-center justify-between gap-3 rounded-lg border border-default bg-default p-4"
        data-testid="home-flags"
      >
        <span class="font-medium">{{ t('dashboard.openFlags') }}</span>
        <span class="tabular text-2xl font-bold">{{ n(stats.totals.flaggedOpen) }}</span>
      </div>

      <section
        v-if="children?.children.length"
        aria-labelledby="unit-children"
        class="flex flex-col gap-2"
      >
        <h2
          id="unit-children"
          class="text-lg font-semibold"
        >
          {{ t('dashboard.childrenHeading') }}
        </h2>
        <p class="text-sm text-muted">
          {{ t('dashboard.childrenHelp') }}
        </p>
        <HomeChildUnitsTable :rows="children.children" />
      </section>
    </template>
  </div>
</template>
