<script setup lang="ts">
// Sync screen (task 4.5 of UX, plan task 4.4): captures made on this phone, refused / waiting / sent, with the reason
// for each refusal in plain words, Fix and Remove, and "Try sending now". Reads only the phone's database, so it works
// offline. PU leads only (the only role with captures to send).
import type { LocalRejectReason, LocalSupporter } from '~/offline/db'
import { getLocalSession } from '~/offline/local-session'
import { listLocalCaptures, removeRejected, type LocalCaptures } from '~/offline/outbox'
import { getLastSyncAt } from '~/offline/sync'

definePageMeta({ layout: 'app', titleKey: 'nav.sync' })

const { t, te, locale } = useI18n()
const toast = useToast()
const online = useOnline()
const sync = useSync()
const { user } = useUserSession()

const localRole = ref<string | null>(null)
onMounted(async () => {
  localRole.value = (await getLocalSession().catch(() => undefined))?.role ?? null
})
const role = computed(() => user.value?.role ?? localRole.value)

const empty: LocalCaptures = { rejected: [], pending: [], sent: [], sentTotal: 0 }
const captures = useLiveQuery(() => listLocalCaptures(), empty)
const lastSyncAt = useLiveQuery(async () => (await getLastSyncAt()) ?? null, null as string | null)

const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value === 'ha' ? 'ha-NG' : 'en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Lagos',
}))
const when = (iso: string) => dateFormat.value.format(new Date(iso))

/** Refusals the lead can correct on this phone; the rest need the ward lead (wrong or closed PU). */
const FIXABLE = new Set<LocalRejectReason>(['invalid', 'no_consent', 'phone_limit', 'conflict'])
const reasonOf = (s: LocalSupporter): LocalRejectReason => s.rejectReason ?? 'invalid'
/** The server's issue keys (field paths and i18n keys only), translated; unknown keys are skipped. */
const issueTexts = (s: LocalSupporter) => (s.issues ?? []).map(i => i.message).filter(key => te(key)).map(key => t(key))

const sending = ref(false)
async function sendNow() {
  sending.value = true
  try {
    const report = await sync.run({ force: true })
    if (!report) return
    if (report.pushError !== undefined) {
      toast.add({ title: t('sync.sendFailed'), color: 'warning', icon: 'i-lucide-cloud-off' })
    }
    else {
      const refused = report.results.filter(r => r.result === 'rejected' || r.result === 'conflict').length
      toast.add({
        title: refused ? t('sync.sentSomeRefused', { count: refused }, refused) : t('sync.sentAll'),
        color: refused ? 'warning' : 'success',
        icon: refused ? 'i-lucide-triangle-alert' : 'i-lucide-check',
      })
    }
  }
  finally {
    sending.value = false
  }
}

const removing = ref<LocalSupporter | null>(null)
const removeOpen = computed({
  get: () => removing.value !== null,
  set: (open: boolean) => {
    if (!open) removing.value = null
  },
})
async function confirmRemove() {
  if (!removing.value) return
  await removeRejected(removing.value.id).catch(() => false)
  removing.value = null
  toast.add({ title: t('sync.removed'), color: 'neutral', icon: 'i-lucide-trash-2' })
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-2xl font-bold">
      {{ t('nav.sync') }}
    </h1>

    <UAlert
      v-if="role && role !== 'PU_LEAD'"
      color="neutral"
      variant="subtle"
      :title="t('sync.notAllowed')"
    />

    <template v-else>
      <section
        aria-labelledby="sync-status"
        class="flex flex-col gap-3 rounded-lg border border-default bg-default p-4"
      >
        <h2
          id="sync-status"
          class="sr-only"
        >
          {{ t('sync.statusHeading') }}
        </h2>
        <p
          class="text-highlighted"
          data-testid="sync-summary"
        >
          {{ online ? t('sync.online') : t('sync.offline') }}
        </p>
        <p
          class="text-muted"
          data-testid="sync-last"
        >
          {{ lastSyncAt ? t('sync.lastSent', { time: when(lastSyncAt) }) : t('sync.neverSent') }}
        </p>
        <UButton
          size="xl"
          class="min-h-12 self-start"
          icon="i-lucide-refresh-cw"
          :label="t('sync.sendNow')"
          :loading="sending || sync.state.value.running"
          :disabled="!online"
          data-testid="sync-send-now"
          @click="sendNow"
        />
        <p
          v-if="!online"
          class="text-sm text-muted"
        >
          {{ t('sync.sendNowOffline') }}
        </p>
      </section>

      <!-- Refused: the lead has something to do. -->
      <section
        v-if="captures.rejected.length"
        aria-labelledby="sync-rejected"
        class="flex flex-col gap-3"
        data-testid="sync-rejected"
      >
        <h2
          id="sync-rejected"
          class="flex items-center gap-2 text-lg font-semibold"
        >
          <UIcon
            name="i-lucide-triangle-alert"
            class="size-5 text-warning"
            aria-hidden="true"
          />
          {{ t('sync.rejectedHeading', { count: captures.rejected.length }, captures.rejected.length) }}
        </h2>
        <ul class="flex flex-col gap-3">
          <li
            v-for="s in captures.rejected"
            :key="s.id"
            class="flex flex-col gap-2 rounded-lg border border-amber-300 bg-default p-4"
            data-testid="sync-rejected-item"
          >
            <p class="font-semibold text-highlighted">
              {{ s.fullName }}
            </p>
            <p class="text-sm text-muted">
              {{ t('sync.capturedAt', { time: when(s.capturedAt) }) }}
            </p>
            <p
              class="text-highlighted"
              data-testid="sync-rejected-reason"
            >
              {{ t(`sync.reasons.${reasonOf(s)}`) }}
            </p>
            <ul
              v-if="issueTexts(s).length"
              class="list-disc ps-5 text-sm text-highlighted"
            >
              <li
                v-for="text in issueTexts(s)"
                :key="text"
              >
                {{ text }}
              </li>
            </ul>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-if="FIXABLE.has(reasonOf(s))"
                :to="{ path: '/app/capture', query: { fix: s.id } }"
                size="xl"
                class="min-h-12"
                icon="i-lucide-pencil"
                :label="t('sync.fix')"
                data-testid="sync-fix"
              />
              <UButton
                size="xl"
                color="neutral"
                variant="outline"
                class="min-h-12"
                icon="i-lucide-trash-2"
                :label="t('sync.remove')"
                data-testid="sync-remove"
                @click="removing = s"
              />
            </div>
          </li>
        </ul>
      </section>

      <section
        aria-labelledby="sync-pending"
        class="flex flex-col gap-3"
        data-testid="sync-pending"
      >
        <h2
          id="sync-pending"
          class="text-lg font-semibold"
        >
          {{ t('sync.pendingHeading', { count: captures.pending.length }, captures.pending.length) }}
        </h2>
        <p
          v-if="!captures.pending.length"
          class="text-muted"
        >
          {{ t('sync.pendingNone') }}
        </p>
        <ul
          v-else
          class="divide-y divide-default rounded-lg border border-default bg-default"
        >
          <li
            v-for="s in captures.pending"
            :key="s.id"
            class="flex flex-col gap-1 p-4"
            data-testid="sync-pending-item"
          >
            <span class="font-medium text-highlighted">{{ s.fullName }}</span>
            <span class="text-sm text-muted">
              {{ t('sync.capturedAt', { time: when(s.capturedAt) }) }}
              <template v-if="s.attempts"> · {{ t('sync.attempts', { count: s.attempts }, s.attempts) }}</template>
            </span>
          </li>
        </ul>
      </section>

      <section
        aria-labelledby="sync-sent"
        class="flex flex-col gap-3"
        data-testid="sync-sent"
      >
        <h2
          id="sync-sent"
          class="text-lg font-semibold"
        >
          {{ t('sync.sentHeading', { count: captures.sentTotal }, captures.sentTotal) }}
        </h2>
        <p
          v-if="captures.sentTotal > captures.sent.length"
          class="text-sm text-muted"
        >
          {{ t('sync.sentLatest', { count: captures.sent.length }) }}
        </p>
        <ul
          v-if="captures.sent.length"
          class="divide-y divide-default rounded-lg border border-default bg-default"
        >
          <li
            v-for="s in captures.sent"
            :key="s.id"
            class="flex items-center gap-3 p-4"
            data-testid="sync-sent-item"
          >
            <UIcon
              name="i-lucide-check"
              class="size-5 shrink-0 text-success"
              aria-hidden="true"
            />
            <span class="flex flex-col">
              <span class="font-medium text-highlighted">{{ s.fullName }}</span>
              <span class="text-sm text-muted">{{ t('sync.capturedAt', { time: when(s.capturedAt) }) }}</span>
            </span>
          </li>
        </ul>
      </section>
    </template>

    <UModal
      v-model:open="removeOpen"
      :title="t('sync.removeTitle')"
      :description="removing ? t('sync.removeConfirm', { name: removing.fullName }) : ''"
    >
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            size="xl"
            color="neutral"
            variant="outline"
            class="min-h-12"
            :label="t('sync.cancel')"
            @click="removing = null"
          />
          <UButton
            size="xl"
            color="error"
            class="min-h-12"
            :label="t('sync.remove')"
            data-testid="sync-remove-confirm"
            @click="confirmRemove"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
