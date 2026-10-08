<script setup lang="ts">
// The map legend (task 6.3, ARCHITECTURE §8: always shown): one swatch per class, plus "no data" (hatched grey).
import type { ChildMetric } from '~~/shared/types/stats'

const props = defineProps<{ metric: ChildMetric, breaks: number[] }>()
const { t, n } = useI18n()

const PERCENT: ChildMetric[] = ['coverage', 'verifiedRate', 'progress']
const format = (v: number) => (PERCENT.includes(props.metric)
  ? n(v, { style: 'percent', maximumFractionDigits: 0 })
  : n(Math.round(v)))
const rows = computed(() => legendRows(props.breaks, format))
</script>

<template>
  <div
    class="flex flex-col gap-1 rounded-lg border border-default bg-default p-3 text-sm"
    data-testid="map-legend"
  >
    <p class="font-semibold">
      {{ t(`map.metrics.${props.metric}`) }}
    </p>
    <ul class="flex flex-col gap-1">
      <li
        v-for="row in rows"
        :key="row.from"
        class="flex items-center gap-2"
      >
        <span
          class="size-4 shrink-0 rounded-sm border border-default"
          :style="{ backgroundColor: row.color }"
          aria-hidden="true"
        />
        <span class="tabular">{{ row.to === null ? t('map.legendFrom', { from: row.from }) : t('map.legendRange', { from: row.from, to: row.to }) }}</span>
      </li>
      <li class="flex items-center gap-2">
        <span
          class="size-4 shrink-0 rounded-sm border border-default"
          style="background: repeating-linear-gradient(135deg, #EDEDED 0 3px, #A3A3A3 3px 4px)"
          aria-hidden="true"
        />
        <span>{{ t('map.noData') }}</span>
      </li>
    </ul>
  </div>
</template>
