<script setup lang="ts">
// Targets (task 6.4, PRD US-15, ADR-048): the lead's own target and progress, the units below with theirs, setting
// each one, and splitting the own target across them. The DG sets the state targets (the region has none of its own).
// Saved values show at once; the stats behind progress refresh within a minute (60 s cache).
import { TEAM_ROLES } from '~/utils/nav'
import { allocation } from '~/utils/targets'
import type { ChildrenStats, UnitStats } from '~~/shared/types/stats'
import type { DistributeResult, SetTargetResult } from '~~/shared/types/targets'
import { toUrlCode } from '~~/shared/utils/pu-code'

definePageMeta({ layout: 'app', titleKey: 'targets.title' })

const { t, n } = useI18n()
const { data: me } = await useFetch('/api/auth/me', { key: 'me' })
const role = computed(() => me.value?.user.role ?? null)
const allowed = computed(() => !!role.value && TEAM_ROLES.includes(role.value))
const isDg = computed(() => role.value === 'DG')
/** The caller's unit, `''` for the DG's region. */
const code = computed(() => (allowed.value ? me.value?.scope.unitCode ?? null : null))
const url = computed(() => (code.value === null ? null : toUrlCode(code.value)))

// No fixed keys: the URL decides (see PROGRESS, 6.3).
const { data: stats, error } = await useFetch<UnitStats>(() => (url.value ? `/api/stats/unit/${url.value}` : ''), { immediate: !!url.value })
const { data: children } = await useFetch<ChildrenStats>(() => (url.value ? `/api/stats/children/${url.value}?metric=supporters&sort=desc` : ''), { immediate: !!url.value })

/** Targets saved on this page, shown before the cached stats catch up. */
const saved = reactive(new Map<string, number>())
const rows = computed(() => [...(children.value?.children ?? [])]
  .sort((a, b) => a.code.localeCompare(b.code))
  .map((r) => {
    const target = saved.get(r.code) ?? r.target
    return { ...r, target, progress: target ? r.supporters / target : null }
  }))
const ownTarget = computed(() => (code.value ? saved.get(code.value) ?? stats.value?.target ?? null : null))
const alloc = computed(() => allocation(ownTarget.value, rows.value.map(r => r.target)))
const childTotal = computed(() => rows.value.reduce((a, r) => a + (r.target ?? 0), 0))

const pct = (x: number | null) => (x === null ? '—' : n(x, { style: 'percent', maximumFractionDigits: 0 }))
const ringLabel = computed(() => (ownTarget.value && stats.value
  ? t('dashboard.progressLabel', { value: n(stats.value.totals.supporters), target: n(ownTarget.value) })
  : t('dashboard.noTarget')))
const allocText = computed(() => {
  const a = alloc.value
  if (a.kind === 'no_target') return t('targets.allocation.noTarget')
  if (a.kind === 'exact') return t('targets.allocation.exact')
  return t(a.kind === 'under' ? 'targets.allocation.under' : 'targets.allocation.over', { amount: n(a.amount) })
})

const editing = ref<{ code: string, name: string, current: number | null } | null>(null)
const editOpen = computed({
  get: () => editing.value !== null,
  set: (v) => {
    if (!v) editing.value = null
  },
})
const splitOpen = ref(false)

function onSaved(result: SetTargetResult) {
  saved.set(result.code, result.target)
}
function onSplit(result: DistributeResult) {
  // The split used the current own target, which the cached stats may not show yet (set above within the last minute).
  saved.set(result.code, result.target)
  for (const c of result.children) saved.set(c.code, c.target)
}
</script>

<template>
  <section class="flex flex-col gap-6">
    <h1 class="text-2xl font-bold">
      {{ t('targets.title') }}
    </h1>

    <UAlert
      v-if="!allowed"
      color="warning"
      variant="subtle"
      :title="t('targets.errors.notAllowed')"
    />
    <UAlert
      v-else-if="error"
      color="warning"
      variant="subtle"
      icon="i-lucide-cloud-off"
      :title="t('dashboard.loadFailed')"
    />

    <template v-else-if="stats">
      <section
        aria-labelledby="targets-own"
        class="flex flex-col gap-4 rounded-lg border border-default bg-default p-4"
        data-testid="targets-own"
      >
        <h2
          id="targets-own"
          class="text-lg font-semibold"
        >
          {{ stats.unit.level === 'region' ? t('dashboard.region') : stats.unit.name }}
        </h2>

        <div
          v-if="!isDg"
          class="flex flex-wrap items-center gap-6"
        >
          <ChartsProgressRing
            :value="stats.totals.supporters"
            :target="ownTarget"
            :label="ringLabel"
          />
          <dl class="grid grid-cols-2 gap-x-6 gap-y-2">
            <div>
              <dt class="text-sm text-muted">
                {{ t('dashboard.target') }}
              </dt>
              <dd
                class="tabular text-2xl font-bold"
                data-testid="targets-own-value"
              >
                {{ ownTarget === null ? '—' : n(ownTarget) }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-muted">
                {{ t('dashboard.supporters') }}
              </dt>
              <dd class="tabular text-2xl font-bold">
                {{ n(stats.totals.supporters) }}
              </dd>
            </div>
          </dl>
        </div>
        <p
          v-if="!isDg && ownTarget === null"
          class="text-muted"
        >
          {{ t('targets.ownSetAbove') }}
        </p>

        <p
          :class="alloc.kind === 'over' ? 'text-warning' : 'text-muted'"
          data-testid="targets-allocation"
        >
          {{ isDg ? t('targets.allocation.statesTotal', { total: n(childTotal) }) : allocText }}
        </p>

        <UButton
          v-if="!isDg"
          class="min-h-12 self-start"
          icon="i-lucide-split"
          :disabled="ownTarget === null || !rows.length"
          :label="t('targets.split.open')"
          data-testid="targets-split"
          @click="splitOpen = true"
        />
      </section>

      <section
        aria-labelledby="targets-children"
        class="flex flex-col gap-3"
      >
        <h2
          id="targets-children"
          class="text-lg font-semibold"
        >
          {{ t('targets.childrenHeading') }}
        </h2>
        <p class="text-sm text-muted">
          {{ t('targets.staleNote') }}
        </p>
        <ul class="flex flex-col gap-3">
          <li
            v-for="row in rows"
            :key="row.code"
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default bg-default p-3"
            :data-testid="`target-row-${row.code}`"
          >
            <div class="min-w-0">
              <p class="font-medium">
                {{ row.name }}
                <span class="tabular block text-sm font-normal text-muted">{{ row.code }}</span>
              </p>
              <p class="tabular">
                {{ t('dashboard.target') }}:
                <span
                  class="font-semibold"
                  data-testid="target-row-value"
                >{{ row.target === null ? '—' : n(row.target) }}</span>
                · {{ t('dashboard.col.progress') }}: {{ pct(row.progress) }}
              </p>
            </div>
            <UButton
              class="min-h-12"
              variant="outline"
              icon="i-lucide-pencil"
              :label="t('targets.set')"
              :aria-label="t('targets.setFor', { name: row.name })"
              data-testid="target-row-edit"
              @click="editing = { code: row.code, name: row.name, current: row.target }"
            />
          </li>
        </ul>
      </section>

      <TargetsTargetDialog
        v-if="editing"
        v-model:open="editOpen"
        :code="editing.code"
        :name="editing.name"
        :current="editing.current"
        @saved="onSaved"
      />
      <TargetsSplitDialog
        v-if="splitOpen && code"
        v-model:open="splitOpen"
        :code="code"
        @saved="onSplit"
      />
    </template>
  </section>
</template>
