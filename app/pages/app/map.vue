<script setup lang="ts">
// Map (task 6.3, UX §4.3, PRD US-12/13): the caller's unit with its children shaded by a metric; tap a unit for its
// numbers, then zoom in, open its dashboard or its team. Starts at the caller's own unit (DG/admin: the region) and
// never goes above it. The map itself is a lazy component; the same units are always available as a list.
import type { PuPointsResponse } from '~~/shared/types/geo'
import { CHILD_METRICS, type ChildMetric, type ChildrenStats } from '~~/shared/types/stats'
import { toUrlCode } from '~~/shared/utils/pu-code'

definePageMeta({ layout: 'app', titleKey: 'nav.map' })

const { t, n } = useI18n()
const { data: me } = await useFetch('/api/auth/me', { key: 'me' })
const scope = computed(() => me.value?.scope.unitCode ?? null)
const canMap = computed(() => !!me.value && me.value.user.role !== 'PU_LEAD')

const code = ref<string | null>(null)
watch(scope, (s) => {
  if (code.value === null && s !== null) code.value = s
}, { immediate: true })
const metric = ref<ChildMetric>('coverage')

const childrenUrl = computed(() => (code.value === null || !canMap.value ? '' : `/api/stats/children/${toUrlCode(code.value)}`))
// No fixed key: Nuxt keys the request on the URL and query, so drilling down fetches the new unit's children.
const { data: children, error } = await useFetch<ChildrenStats>(childrenUrl, {
  query: { metric, sort: 'asc' },
  immediate: !!childrenUrl.value,
})
const isWard = computed(() => code.value !== null && code.value.length === 8)
// A ward shows its PU points (fetched only then).
const points = ref<PuPointsResponse | null>(null)
watch([isWard, code], async ([ward, c]) => {
  points.value = null
  if (!ward || c === null) return
  points.value = await $fetch<PuPointsResponse>('/api/geo/pus', { query: { ward: toUrlCode(c) } }).catch(() => null)
}, { immediate: true })

// Names seen so far, for the breadcrumb (the API returns the children's names at each step).
const names = reactive<Record<string, string>>({})
watch(me, (m) => {
  if (m?.unit) names[m.unit.code] = m.unit.name // the caller's own unit (no parent listed it)
}, { immediate: true })
watch(children, (c) => {
  for (const row of c?.children ?? []) names[row.code] = row.name
}, { immediate: true })
const crumbs = computed(() => (code.value === null || scope.value === null ? [] : breadcrumb(code.value, scope.value, names, t('dashboard.region'))))

const rows = computed(() => children.value?.children ?? [])
const breaks = computed(() => classBreaks(rows.value.map(r => metricValue(r, metric.value)), metric.value))
// PU points are always coloured by coverage.
const pointBreaks = computed(() => (isWard.value ? classBreaks([], 'coverage') : breaks.value))
const legendMetric = computed<ChildMetric>(() => (isWard.value ? 'coverage' : metric.value))

// ── Selection (bottom sheet) ──
const selected = ref<string | null>(null)
const selectedRow = computed(() => rows.value.find(r => r.code === selected.value) ?? null)
const sheetOpen = computed({
  get: () => selected.value !== null,
  set: (v: boolean) => {
    if (!v) selected.value = null
  },
})
const pct = (x: number | null) => (x === null ? '—' : n(x, { style: 'percent', maximumFractionDigits: 0 }))

function zoomIn() {
  if (!selectedRow.value || selectedRow.value.level === 'pu') return
  code.value = selectedRow.value.code
  selected.value = null
}

const hover = ref<string | null>(null)
const showList = ref(false)
const mapLabel = computed(() => t('map.canvasLabel', { unit: crumbs.value.at(-1)?.name ?? '' }))
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="sr-only">
      {{ t('nav.map') }}
    </h1>

    <UAlert
      v-if="me && !canMap"
      color="neutral"
      variant="subtle"
      :title="t('map.notAllowed')"
    />
    <UAlert
      v-else-if="error"
      color="warning"
      variant="subtle"
      icon="i-lucide-cloud-off"
      :title="t('dashboard.loadFailed')"
    />

    <template v-else-if="code !== null">
      <MapBreadcrumb
        :items="crumbs"
        @go="(c) => { code = c; selected = null }"
      />

      <div
        v-if="!isWard"
        class="flex flex-wrap gap-2"
        role="group"
        :aria-label="t('map.metricLegend')"
      >
        <UButton
          v-for="m in CHILD_METRICS"
          :key="m"
          :color="metric === m ? 'primary' : 'neutral'"
          :variant="metric === m ? 'solid' : 'outline'"
          class="min-h-12"
          :aria-pressed="metric === m"
          :label="t(`map.metrics.${m}`)"
          :data-testid="`map-metric-${m}`"
          @click="metric = m"
        />
      </div>

      <div class="grid gap-4 md:grid-cols-[1fr_22rem]">
        <div class="relative h-[60vh] overflow-hidden rounded-lg border border-default">
          <LazyMapUnitMap
            :code="code"
            :metric="metric"
            :rows="rows"
            :points="points?.points ?? []"
            :breaks="isWard ? pointBreaks : breaks"
            :highlight="hover"
            :label="mapLabel"
            @select="(c) => (selected = c)"
          />
          <div class="pointer-events-none absolute bottom-2 left-2">
            <MapLegend
              :metric="legendMetric"
              :breaks="isWard ? pointBreaks : breaks"
            />
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <UButton
            class="min-h-12 self-start md:hidden"
            color="neutral"
            variant="outline"
            :icon="showList ? 'i-lucide-map' : 'i-lucide-list'"
            :label="t(showList ? 'map.hideList' : 'map.showList')"
            :aria-expanded="showList"
            data-testid="map-list-toggle"
            @click="showList = !showList"
          />
          <div
            :class="showList ? 'block' : 'hidden md:block'"
            class="max-h-[60vh] overflow-y-auto"
          >
            <HomeChildUnitsTable
              :rows="rows"
              selectable
              @select="(c) => (selected = c)"
              @hover="(c) => (hover = c)"
            />
          </div>
        </div>
      </div>
    </template>

    <UDrawer
      v-model:open="sheetOpen"
      :title="selectedRow?.name ?? ''"
      :description="selectedRow?.code ?? ''"
    >
      <template #body>
        <dl
          v-if="selectedRow"
          class="grid grid-cols-2 gap-3"
          data-testid="map-sheet"
        >
          <div>
            <dt class="text-sm text-muted">
              {{ t('dashboard.supporters') }}
            </dt>
            <dd class="tabular text-xl font-bold">
              {{ n(selectedRow.supporters) }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              {{ t('dashboard.coverage') }}
            </dt>
            <dd class="tabular text-xl font-bold">
              {{ pct(selectedRow.coverage) }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              {{ t('dashboard.col.progress') }}
            </dt>
            <dd class="tabular text-xl font-bold">
              {{ pct(selectedRow.progress) }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              {{ t('dashboard.openFlags') }}
            </dt>
            <dd class="tabular text-xl font-bold">
              {{ n(selectedRow.flaggedOpen) }}
            </dd>
          </div>
        </dl>
      </template>
      <template #footer>
        <div
          v-if="selectedRow"
          class="flex flex-wrap gap-2"
        >
          <UButton
            v-if="selectedRow.level !== 'pu'"
            size="xl"
            class="min-h-12"
            icon="i-lucide-zoom-in"
            :label="t('map.zoomIn')"
            data-testid="map-zoom-in"
            @click="zoomIn"
          />
          <UButton
            size="xl"
            class="min-h-12"
            color="neutral"
            variant="outline"
            icon="i-lucide-layout-dashboard"
            :to="`/app/units/${toUrlCode(selectedRow.code)}`"
            :label="t('map.openDashboard')"
            data-testid="map-open-dashboard"
          />
          <UButton
            v-if="selectedRow.level !== 'pu'"
            size="xl"
            class="min-h-12"
            color="neutral"
            variant="outline"
            icon="i-lucide-users"
            :to="{ path: '/app/team', query: { unit: toUrlCode(selectedRow.code) } }"
            :label="t('nav.team')"
          />
        </div>
      </template>
    </UDrawer>
  </div>
</template>
