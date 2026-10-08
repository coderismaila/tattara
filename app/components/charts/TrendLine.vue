<script setup lang="ts">
// A 30-day trend as a small line (task 6.2). Decorative to screen readers: the caller states the numbers in text.
import type { TrendPoint } from '~/utils/charts'

const props = withDefaults(defineProps<{ points: TrendPoint[], width?: number, height?: number }>(), { width: 240, height: 48 })
const path = computed(() => trendPath(props.points, props.width, props.height))
</script>

<template>
  <svg
    :viewBox="`0 0 ${props.width} ${props.height}`"
    :width="props.width"
    :height="props.height"
    class="max-w-full overflow-visible text-primary"
    aria-hidden="true"
    focusable="false"
  >
    <path
      v-if="path"
      :d="path"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
