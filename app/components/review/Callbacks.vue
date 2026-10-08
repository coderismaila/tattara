<script setup lang="ts">
// The ward lead's call-backs (task 5.3): today's, open ones from earlier days, and the ward's 30-day pass rate.
// Needs a connection (calls and outcomes are server-side).
import type { CallbackListResponse } from '~~/shared/types/callbacks'

const { t, n, locale } = useI18n()

const { data, error, refresh, status } = await useFetch<CallbackListResponse>('/api/callbacks', { key: 'callbacks' })
const forbidden = computed(() => error.value?.statusCode === 403)

const open = computed(() => data.value?.items.filter(i => !i.outcome) ?? [])
const done = computed(() => data.value?.items.filter(i => i.outcome) ?? [])

const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value === 'ha' ? 'ha-NG' : 'en-NG', {
  dateStyle: 'medium',
  timeZone: 'Africa/Lagos',
}))
const when = (iso: string) => dateFormat.value.format(new Date(iso))

const passRate = computed(() => {
  const p = data.value?.passRate
  if (!p || p.rate === null) return t('callback.passRateNone')
  return t('callback.passRate', {
    rate: n(p.rate, { style: 'percent', maximumFractionDigits: 0 }),
    answered: p.verified + p.failed,
    unreachable: p.unreachable,
  })
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <UAlert
      v-if="forbidden"
      color="neutral"
      variant="subtle"
      :title="t('callback.notAllowed')"
    />
    <UAlert
      v-else-if="error"
      color="warning"
      variant="subtle"
      icon="i-lucide-cloud-off"
      :title="t('callback.loadFailed')"
    />

    <template v-else-if="data">
      <section
        aria-labelledby="callbacks-heading"
        class="flex flex-col gap-3"
      >
        <div class="flex flex-col gap-1">
          <h2
            id="callbacks-heading"
            class="text-lg font-semibold"
          >
            {{ t('callback.heading') }}
          </h2>
          <p
            class="text-muted"
            data-testid="callback-progress"
          >
            {{ t('callback.progress', { done: done.length, total: data.items.length }) }}
          </p>
          <p
            class="text-muted"
            data-testid="callback-pass-rate"
          >
            {{ passRate }}
          </p>
        </div>

        <p
          v-if="!data.items.length"
          class="rounded-lg border border-default bg-default p-4 text-muted"
          data-testid="callback-none"
        >
          {{ t('callback.none') }}
        </p>

        <ul
          v-if="open.length"
          class="flex flex-col gap-3"
        >
          <ReviewCallbackCard
            v-for="item in open"
            :key="item.id"
            :item="item"
            :when="when"
            @done="refresh()"
          />
        </ul>

        <template v-if="done.length">
          <h3 class="font-semibold">
            {{ t('callback.doneHeading') }}
          </h3>
          <ul class="divide-y divide-default rounded-lg border border-default bg-default">
            <li
              v-for="item in done"
              :key="item.id"
              class="flex items-center gap-3 p-4"
              data-testid="callback-done"
            >
              <UIcon
                :name="item.outcome === 'verified' ? 'i-lucide-check' : item.outcome === 'unreachable' ? 'i-lucide-phone-missed' : 'i-lucide-x'"
                class="size-5 shrink-0"
                :class="item.outcome === 'verified' ? 'text-success' : item.outcome === 'unreachable' ? 'text-muted' : 'text-warning'"
                aria-hidden="true"
              />
              <span class="flex flex-col">
                <span class="font-medium text-highlighted">{{ item.supporter.fullName }}</span>
                <span class="text-sm text-muted">{{ t(`callback.outcomes.${item.outcome}`) }}</span>
              </span>
            </li>
          </ul>
        </template>

        <UButton
          color="neutral"
          variant="ghost"
          class="min-h-12 self-start"
          icon="i-lucide-refresh-cw"
          :label="t('callback.reload')"
          :loading="status === 'pending'"
          @click="refresh()"
        />
      </section>
    </template>
  </div>
</template>
