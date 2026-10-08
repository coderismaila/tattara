<script setup lang="ts">
// A unit's quality score on the Team list (task 5.5, PRD R-7): the number with a word (never colour alone), and what
// it is made of, behind a disclosure. Aggregates only.
import type { TeamQuality } from '~~/shared/types/team'

const props = defineProps<{ code: string, score: number | null, quality: TeamQuality | null }>()
const { t, n, locale } = useI18n()

/** Bands for the word and colour: ≥ 75 good, 50–74 fair, below 50 low. */
const band = computed(() => props.score === null ? null : props.score >= 75 ? 'good' : props.score >= 50 ? 'fair' : 'low')
const color = computed(() => ({ good: 'success', fair: 'warning', low: 'error' } as const)[band.value ?? 'good'])
const pct = (x: number) => n(x, { style: 'percent', maximumFractionDigits: 0 })
const computedOn = computed(() => props.quality
  ? new Intl.DateTimeFormat(locale.value === 'ha' ? 'ha-NG' : 'en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }).format(new Date(props.quality.computedAt))
  : '')
</script>

<template>
  <div
    class="flex flex-col gap-2"
    :data-testid="`team-quality-${props.code}`"
  >
    <p class="flex flex-wrap items-center gap-2 text-sm">
      <span>{{ t('team.quality.label') }}:</span>
      <UBadge
        v-if="band"
        :color="color"
        variant="subtle"
        size="lg"
        class="tabular"
        :data-testid="`team-quality-score-${props.code}`"
      >
        {{ props.score }} · {{ t(`team.quality.band.${band}`) }}
      </UBadge>
      <span
        v-else
        class="text-muted"
      >{{ t('team.quality.notEnough') }}</span>
    </p>
    <details
      v-if="props.quality"
      class="text-sm"
    >
      <summary class="min-h-12 cursor-pointer content-center font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary">
        {{ t('team.quality.why') }}
      </summary>
      <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt class="text-muted">
          {{ t('team.quality.supporters') }}
        </dt>
        <dd class="tabular">
          {{ n(props.quality.supporters) }}
        </dd>
        <dt class="text-muted">
          {{ t('team.quality.verified') }}
        </dt>
        <dd class="tabular">
          {{ pct(props.quality.verifiedRate) }}
        </dd>
        <dt class="text-muted">
          {{ t('team.quality.callbacks') }}
        </dt>
        <dd class="tabular">
          {{ props.quality.passRate === null ? t('team.quality.tooFewCalls') : pct(props.quality.passRate) }}
        </dd>
        <dt class="text-muted">
          {{ t('team.quality.flags') }}
        </dt>
        <dd class="tabular">
          {{ pct(props.quality.flagRate) }}
        </dd>
        <dt class="text-muted">
          {{ t('team.quality.optOuts') }}
        </dt>
        <dd class="tabular">
          {{ pct(props.quality.optOutRate) }}
        </dd>
      </dl>
      <p class="mt-1 text-muted">
        {{ t('team.quality.note', { date: computedOn }) }}
      </p>
    </details>
  </div>
</template>
