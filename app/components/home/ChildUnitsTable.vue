<script setup lang="ts">
// The units one level down, lowest coverage first (task 6.2, UX §4.2: where to act). A plain semantic table (no grid
// library): on phones each row stacks. Units above PU link to their Team list (or select the unit on the map).
import type { ChildStats } from '~~/shared/types/stats'
import { toUrlCode } from '~~/shared/utils/pu-code'

// `selectable` (the map, 6.3): the name selects the unit instead of opening Team, and hovering a row reports it.
const props = defineProps<{ rows: ChildStats[], selectable?: boolean }>()
const emit = defineEmits<{ select: [code: string], hover: [code: string | null] }>()
const { t, n } = useI18n()
const pct = (x: number | null) => (x === null ? '—' : n(x, { style: 'percent', maximumFractionDigits: 0 }))
</script>

<template>
  <table
    class="w-full border-separate border-spacing-0 text-left"
    data-testid="home-children"
  >
    <caption class="sr-only">
      {{ t('dashboard.childrenCaption') }}
    </caption>
    <thead class="max-md:sr-only">
      <tr class="text-sm text-muted">
        <th
          scope="col"
          class="px-3 py-2 font-medium"
        >
          {{ t('dashboard.col.unit') }}
        </th>
        <th
          scope="col"
          class="px-3 py-2 text-right font-medium"
        >
          {{ t('dashboard.col.supporters') }}
        </th>
        <th
          scope="col"
          class="px-3 py-2 text-right font-medium"
        >
          {{ t('dashboard.col.coverage') }}
        </th>
        <th
          scope="col"
          class="px-3 py-2 text-right font-medium"
        >
          {{ t('dashboard.col.progress') }}
        </th>
        <th
          scope="col"
          class="px-3 py-2 text-right font-medium"
        >
          {{ t('dashboard.col.leads') }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="row in props.rows"
        :key="row.code"
        class="max-md:mb-3 max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:rounded-lg max-md:border max-md:border-default max-md:bg-default max-md:p-3 md:odd:bg-default"
        :data-testid="`home-child-${row.code}`"
        @mouseenter="props.selectable && emit('hover', row.code)"
        @mouseleave="props.selectable && emit('hover', null)"
      >
        <th
          scope="row"
          class="px-3 py-2 font-medium max-md:col-span-2 max-md:px-0"
        >
          <button
            v-if="props.selectable"
            type="button"
            class="min-h-12 text-left text-primary underline focus-visible:outline-2 focus-visible:outline-primary"
            @click="emit('select', row.code)"
          >
            {{ row.name }}
          </button>
          <NuxtLink
            v-else-if="row.level !== 'pu'"
            :to="{ path: '/app/team', query: { unit: toUrlCode(row.code) } }"
            class="text-primary underline"
          >{{ row.name }}</NuxtLink>
          <span v-else>{{ row.name }}</span>
          <span class="tabular block text-sm font-normal text-muted">{{ row.code }}</span>
        </th>
        <td class="tabular px-3 py-1 md:text-right max-md:px-0">
          <span
            class="text-sm text-muted md:hidden"
            aria-hidden="true"
          >{{ t('dashboard.col.supporters') }}: </span>{{ n(row.supporters) }}
        </td>
        <td
          class="tabular px-3 py-1 md:text-right max-md:px-0"
          data-testid="home-child-coverage"
        >
          <span
            class="text-sm text-muted md:hidden"
            aria-hidden="true"
          >{{ t('dashboard.col.coverage') }}: </span>{{ pct(row.coverage) }}
        </td>
        <td class="tabular px-3 py-1 md:text-right max-md:px-0">
          <span
            class="text-sm text-muted md:hidden"
            aria-hidden="true"
          >{{ t('dashboard.col.progress') }}: </span>{{ pct(row.progress) }}
        </td>
        <td class="tabular px-3 py-1 md:text-right max-md:px-0">
          <span
            class="text-sm text-muted md:hidden"
            aria-hidden="true"
          >{{ t('dashboard.col.leads') }}: </span>{{ n(row.activeLeads) }}
        </td>
      </tr>
    </tbody>
  </table>
</template>
