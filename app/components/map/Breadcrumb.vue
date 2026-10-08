<script setup lang="ts">
// Where the map is (task 6.3, UX §4.3): NW › Kano › Ajingi › … within the caller's scope; earlier steps go back up.
const props = defineProps<{ items: { code: string, name: string }[] }>()
const emit = defineEmits<{ go: [code: string] }>()
const { t } = useI18n()
</script>

<template>
  <nav
    :aria-label="t('map.breadcrumb')"
    data-testid="map-breadcrumb"
  >
    <ol class="flex flex-wrap items-center gap-1 text-sm">
      <li
        v-for="(item, i) in props.items"
        :key="item.code"
        class="flex items-center gap-1"
      >
        <UIcon
          v-if="i > 0"
          name="i-lucide-chevron-right"
          class="size-4 text-muted"
          aria-hidden="true"
        />
        <button
          v-if="i < props.items.length - 1"
          type="button"
          class="min-h-12 rounded-md px-2 text-primary underline focus-visible:outline-2 focus-visible:outline-primary"
          @click="emit('go', item.code)"
        >
          {{ item.name }}
        </button>
        <span
          v-else
          class="px-2 font-semibold"
          aria-current="location"
        >{{ item.name }}</span>
      </li>
    </ol>
  </nav>
</template>
