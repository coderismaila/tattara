<script setup lang="ts">
import { deactivateSchema, inviteSchema } from '~~/shared/schemas/team'
import type { TeamMember } from '~~/shared/types/team'

definePageMeta({ layout: 'app', titleKey: 'nav.team' })

const { t, n, locale } = useI18n()
const toast = useToast()

const { data, error, refresh } = await useFetch('/api/team', { key: 'team' })
const forbidden = computed(() => error.value?.statusCode === 403)

type DialogKind = 'invite' | 'replace' | 'deactivate' | 'reset'
const dialog = ref<{ kind: DialogKind, member: TeamMember } | null>(null)
const dialogOpen = computed({
  get: () => dialog.value !== null,
  set: (open) => {
    if (!open) dialog.value = null
  },
})

const fullName = ref('')
const phone = ref('')
const reason = ref('')
const busy = ref(false)
const formError = ref<AuthErrorMessage | null>(null)

const STATUS_COLOR = { active: 'success', invited: 'warning', locked: 'error' } as const

function open(kind: DialogKind, member: TeamMember) {
  fullName.value = ''
  phone.value = ''
  reason.value = ''
  formError.value = null
  dialog.value = { kind, member }
}

const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value === 'ha' ? 'ha-NG' : 'en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Lagos',
}))

async function run(action: () => Promise<unknown>, done: string) {
  busy.value = true
  formError.value = null
  try {
    await action()
    toast.add({ title: done, color: 'success' })
    dialog.value = null
    await refresh()
  }
  catch (e) {
    formError.value = teamErrorMessage(e)
    if (!dialog.value) toast.add({ title: t(formError.value.key, formError.value.params ?? {}), color: 'error' })
  }
  finally {
    busy.value = false
  }
}

async function submitInvite() {
  const d = dialog.value!
  const parsed = inviteSchema.safeParse({ unitCode: d.member.code, fullName: fullName.value, phone: phone.value, replace: d.kind === 'replace' })
  if (!parsed.success) {
    formError.value = { key: parsed.error.issues[0]!.message }
    return
  }
  await run(() => $fetch('/api/team/invite', { method: 'POST', body: parsed.data }), t('team.inviteSent', { phone: parsed.data.phone }))
}

/** Pending invite: send the same person a fresh link (no dialog). */
async function resend(member: TeamMember) {
  const lead = member.lead!
  await run(() => $fetch('/api/team/invite', { method: 'POST', body: { unitCode: member.code, fullName: lead.fullName, phone: lead.phone } }), t('team.inviteSent', { phone: lead.phone }))
}

async function submitDeactivate() {
  const lead = dialog.value!.member.lead!
  const parsed = deactivateSchema.safeParse({ reason: reason.value })
  if (!parsed.success) {
    formError.value = { key: parsed.error.issues[0]!.message }
    return
  }
  await run(() => $fetch(`/api/team/${lead.id}/deactivate`, { method: 'POST', body: parsed.data }), t('team.deactivated', { name: lead.fullName }))
}

async function submitReset() {
  const lead = dialog.value!.member.lead!
  await run(() => $fetch(`/api/team/${lead.id}/reset-pin`, { method: 'POST' }), t('team.resetDone', { name: lead.fullName }))
}

// Registered voters (US-24): the ward lead can correct a PU's figure.
const votersTarget = ref<TeamMember | null>(null)
const votersOpen = computed({
  get: () => votersTarget.value !== null,
  set: (isOpen) => {
    if (!isOpen) votersTarget.value = null
  },
})

const dialogTitle = computed(() => {
  const d = dialog.value
  if (!d) return ''
  const name = d.member.lead?.fullName ?? ''
  return {
    invite: t('team.inviteTitle', { unit: d.member.name }),
    replace: t('team.replaceTitle', { unit: d.member.name }),
    deactivate: t('team.deactivateTitle', { name }),
    reset: t('team.resetTitle', { name }),
  }[d.kind]
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold">
        {{ t('team.title') }}
      </h1>
      <p
        v-if="data"
        class="text-muted"
      >
        {{ t('team.intro', { unit: data.unit.name || t('team.region') }) }}
      </p>
    </div>

    <UAlert
      v-if="forbidden"
      color="warning"
      variant="subtle"
      :title="t('team.notAllowed')"
    />

    <p
      v-else-if="data && data.members.length === 0"
      class="text-muted"
    >
      {{ t('team.empty') }}
    </p>

    <ul
      v-else-if="data"
      class="flex flex-col gap-3"
      data-testid="team-list"
    >
      <li
        v-for="member in data.members"
        :key="member.code"
        class="flex flex-col gap-3 rounded-lg border border-default bg-default p-4"
        :data-testid="`team-member-${member.code}`"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold">
              {{ member.name }}
            </h2>
            <p class="tabular text-sm text-muted">
              {{ member.code }}
            </p>
          </div>
          <UBadge
            :color="member.lead ? STATUS_COLOR[member.lead.status] : 'neutral'"
            variant="subtle"
            size="lg"
            :data-testid="`team-status-${member.code}`"
          >
            {{ t(`team.status.${member.lead?.status ?? 'none'}`) }}
          </UBadge>
        </div>

        <div
          v-if="member.lead"
          class="flex flex-col gap-1"
        >
          <p class="font-medium">
            {{ member.lead.fullName }}
          </p>
          <a
            v-if="data.canManage"
            :href="`tel:${member.lead.phone}`"
            class="tabular text-primary underline"
            :aria-label="t('team.call', { name: member.lead.fullName })"
          >{{ member.lead.phone }}</a>
          <p
            v-else
            class="tabular text-muted"
          >
            {{ member.lead.phone }}
          </p>
          <p class="text-sm text-muted">
            {{ member.lead.lastSeenAt ? t('team.lastActive', { when: dateFormat.format(new Date(member.lead.lastSeenAt)) }) : t('team.neverActive') }}
          </p>
        </div>
        <p
          v-else
          class="text-muted"
        >
          {{ t('team.noLead') }}
        </p>

        <TeamQualityScore
          :code="member.code"
          :score="member.qualityScore"
          :quality="member.quality"
        />

        <p
          v-if="member.level === 'pu'"
          class="text-sm"
          :data-testid="`team-voters-${member.code}`"
        >
          {{ t('units.voters.title') }}:
          <span class="tabular font-semibold">{{ member.registeredVoters === null ? t('units.voters.notRecorded') : n(member.registeredVoters) }}</span>
        </p>

        <div
          v-if="data.canManage"
          class="flex flex-wrap gap-2"
        >
          <UButton
            v-if="member.level === 'pu'"
            class="min-h-12"
            variant="outline"
            color="neutral"
            icon="i-lucide-clipboard-list"
            :label="t('units.voters.correct')"
            :data-testid="`team-voters-edit-${member.code}`"
            @click="votersTarget = member"
          />
          <UButton
            v-if="!member.lead"
            class="min-h-12"
            icon="i-lucide-user-plus"
            :label="t('team.actions.invite')"
            :data-testid="`team-invite-${member.code}`"
            @click="open('invite', member)"
          />
          <template v-else-if="member.lead.status === 'invited'">
            <UButton
              class="min-h-12"
              variant="outline"
              :loading="busy"
              :label="t('team.actions.resend')"
              @click="resend(member)"
            />
            <UButton
              class="min-h-12"
              variant="ghost"
              :label="t('team.actions.inviteOther')"
              @click="open('invite', member)"
            />
          </template>
          <template v-else>
            <UButton
              class="min-h-12"
              variant="outline"
              :label="t('team.actions.replace')"
              @click="open('replace', member)"
            />
            <UButton
              class="min-h-12"
              variant="outline"
              color="neutral"
              :label="t('team.actions.resetPin')"
              @click="open('reset', member)"
            />
            <UButton
              class="min-h-12"
              variant="outline"
              color="error"
              :label="t('team.actions.deactivate')"
              :data-testid="`team-deactivate-${member.code}`"
              @click="open('deactivate', member)"
            />
          </template>
        </div>
      </li>
    </ul>

    <UnitsVotersDialog
      v-if="votersTarget"
      v-model:open="votersOpen"
      :pu-code="votersTarget.code"
      :pu-name="votersTarget.name"
      :current="votersTarget.registeredVoters"
      @saved="refresh()"
    />

    <UModal
      v-model:open="dialogOpen"
      :title="dialogTitle"
    >
      <template #body>
        <form
          v-if="dialog && (dialog.kind === 'invite' || dialog.kind === 'replace')"
          class="flex flex-col gap-4"
          novalidate
          @submit.prevent="submitInvite"
        >
          <UAlert
            v-if="dialog.kind === 'replace'"
            color="warning"
            variant="subtle"
            :title="t('team.replaceWarning', { name: dialog.member.lead?.fullName ?? '' })"
          />
          <UFormField
            :label="t('team.fullName')"
            name="fullName"
            size="xl"
          >
            <UInput
              v-model="fullName"
              autocomplete="off"
              class="w-full"
              size="xl"
              data-testid="invite-name"
            />
          </UFormField>
          <UFormField
            :label="t('team.phone')"
            name="phone"
            size="xl"
          >
            <UInput
              v-model="phone"
              type="tel"
              inputmode="tel"
              autocomplete="off"
              class="w-full"
              size="xl"
              data-testid="invite-phone"
            />
          </UFormField>
          <UAlert
            v-if="formError"
            color="error"
            variant="subtle"
            role="alert"
            :title="t(formError.key, formError.params ?? {})"
            data-testid="team-error"
          />
          <UButton
            type="submit"
            size="xl"
            block
            class="min-h-12"
            :loading="busy"
            :label="t('team.send')"
            data-testid="invite-submit"
          />
        </form>

        <form
          v-else-if="dialog?.kind === 'deactivate'"
          class="flex flex-col gap-4"
          novalidate
          @submit.prevent="submitDeactivate"
        >
          <p>{{ t('team.deactivateIntro') }}</p>
          <UFormField
            :label="t('team.reason')"
            :help="t('team.reasonHelp')"
            name="reason"
            size="xl"
          >
            <UTextarea
              v-model="reason"
              :rows="3"
              class="w-full"
              size="xl"
              data-testid="deactivate-reason"
            />
          </UFormField>
          <UAlert
            v-if="formError"
            color="error"
            variant="subtle"
            role="alert"
            :title="t(formError.key, formError.params ?? {})"
            data-testid="team-error"
          />
          <UButton
            type="submit"
            color="error"
            size="xl"
            block
            class="min-h-12"
            :loading="busy"
            :label="t('team.confirmDeactivate')"
            data-testid="deactivate-submit"
          />
        </form>

        <div
          v-else-if="dialog?.kind === 'reset'"
          class="flex flex-col gap-4"
        >
          <p>{{ t('team.resetIntro') }}</p>
          <UAlert
            v-if="formError"
            color="error"
            variant="subtle"
            role="alert"
            :title="t(formError.key, formError.params ?? {})"
          />
          <UButton
            size="xl"
            block
            class="min-h-12"
            :loading="busy"
            :label="t('team.confirmReset')"
            @click="submitReset"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
