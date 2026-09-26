<script setup lang="ts">
import { dgInviteSchema } from '~~/shared/schemas/admin'

definePageMeta({ layout: 'app', titleKey: 'nav.admin' })

const { t, locale } = useI18n()
const toast = useToast()

const { data, error, refresh } = await useFetch('/api/admin/dg', { key: 'admin-dg' })
const forbidden = computed(() => error.value?.statusCode === 403)
const dg = computed(() => data.value?.dg ?? null)

const STATUS_COLOR = { active: 'success', invited: 'warning', locked: 'error' } as const

const formOpen = ref(false)
const fullName = ref('')
const phone = ref('')
const busy = ref(false)
const formError = ref<AuthErrorMessage | null>(null)
/** An active (or locked) DG is replaced; a pending invite is simply superseded. */
const replacing = computed(() => dg.value !== null && dg.value.status !== 'invited')

function openForm() {
  fullName.value = ''
  phone.value = ''
  formError.value = null
  formOpen.value = true
}

const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value === 'ha' ? 'ha-NG' : 'en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Lagos',
}))

async function submit() {
  const parsed = dgInviteSchema.safeParse({ fullName: fullName.value, phone: phone.value, replace: replacing.value })
  if (!parsed.success) {
    formError.value = { key: parsed.error.issues[0]!.message }
    return
  }
  busy.value = true
  formError.value = null
  try {
    await $fetch('/api/admin/users/dg', { method: 'POST', body: parsed.data })
    toast.add({ title: t('team.inviteSent', { phone: parsed.data.phone }), color: 'success' })
    formOpen.value = false
    await refresh()
  }
  catch (e) {
    formError.value = adminErrorMessage(e)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold">
        {{ t('admin.title') }}
      </h1>
      <p class="text-muted">
        {{ t('admin.intro') }}
      </p>
    </div>

    <UAlert
      v-if="forbidden"
      color="warning"
      variant="subtle"
      :title="t('admin.notAllowed')"
    />

    <section
      v-else-if="data"
      class="flex flex-col gap-3 rounded-lg border border-default bg-default p-4"
      data-testid="admin-dg"
    >
      <div class="flex items-start justify-between gap-3">
        <h2 class="text-lg font-semibold">
          {{ t('admin.dgHeading') }}
        </h2>
        <UBadge
          :color="dg ? STATUS_COLOR[dg.status] : 'neutral'"
          variant="subtle"
          size="lg"
          data-testid="admin-dg-status"
        >
          {{ t(`team.status.${dg?.status ?? 'none'}`) }}
        </UBadge>
      </div>

      <div
        v-if="dg"
        class="flex flex-col gap-1"
      >
        <p
          class="font-medium"
          data-testid="admin-dg-name"
        >
          {{ dg.fullName }}
        </p>
        <p class="tabular text-muted">
          {{ dg.phone }}
        </p>
        <p class="text-sm text-muted">
          {{ dg.lastSeenAt ? t('team.lastActive', { when: dateFormat.format(new Date(dg.lastSeenAt)) }) : t('team.neverActive') }}
        </p>
      </div>
      <p
        v-else
        class="text-muted"
      >
        {{ t('admin.noDg') }}
      </p>

      <UButton
        class="min-h-12 self-start"
        :variant="replacing ? 'outline' : 'solid'"
        :icon="replacing ? undefined : 'i-lucide-user-plus'"
        :label="t(replacing ? 'admin.replaceDg' : (dg ? 'team.actions.inviteOther' : 'admin.inviteDg'))"
        data-testid="admin-dg-open"
        @click="openForm"
      />
    </section>

    <UModal
      v-model:open="formOpen"
      :title="t(replacing ? 'admin.replaceDg' : 'admin.inviteDg')"
    >
      <template #body>
        <form
          class="flex flex-col gap-4"
          novalidate
          @submit.prevent="submit"
        >
          <UAlert
            v-if="replacing && dg"
            color="warning"
            variant="subtle"
            :title="t('admin.replaceWarning', { name: dg.fullName })"
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
            data-testid="admin-error"
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
      </template>
    </UModal>
  </div>
</template>
