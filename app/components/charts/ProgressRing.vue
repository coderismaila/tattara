<script setup lang="ts">
// Progress toward a target as a ring with the percentage inside (task 6.2). The text inside is what screen readers
// get (role img + label); the arc itself is decorative.
const props = withDefaults(defineProps<{ value: number, target: number | null, label: string, size?: number }>(), { size: 112 })
const { n } = useI18n()
const r = computed(() => props.size / 2 - 8)
const fraction = computed(() => ringFraction(props.value, props.target))
const percent = computed(() => (props.target ? n(props.value / props.target, { style: 'percent', maximumFractionDigits: 0 }) : '—'))
</script>

<template>
  <div
    class="relative inline-grid place-items-center"
    :style="{ width: `${props.size}px`, height: `${props.size}px` }"
    role="img"
    :aria-label="props.label"
  >
    <svg
      :viewBox="`0 0 ${props.size} ${props.size}`"
      class="absolute inset-0 -rotate-90"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        :cx="props.size / 2"
        :cy="props.size / 2"
        :r="r"
        fill="none"
        class="stroke-accented"
        stroke-width="10"
      />
      <circle
        v-if="fraction !== null"
        :cx="props.size / 2"
        :cy="props.size / 2"
        :r="r"
        fill="none"
        :class="fraction >= 1 ? 'stroke-success' : 'stroke-primary'"
        stroke-width="10"
        stroke-linecap="round"
        :stroke-dasharray="ringDash(fraction, r)"
      />
    </svg>
    <span
      class="tabular text-xl font-bold"
      aria-hidden="true"
    >{{ percent }}</span>
  </div>
</template>
