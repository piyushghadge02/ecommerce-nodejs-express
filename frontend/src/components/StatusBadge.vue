<script setup>
import { computed } from 'vue'

const props = defineProps({
  status: { type: String, required: true },
})

const tone = computed(() => {
  switch (props.status) {
    case 'PENDING':
      return 'bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900'
    case 'PROCESSING':
      return 'bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-900'
    case 'SHIPPED':
      return 'bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900'
    default:
      return 'bg-stone-100 text-stone-700 ring-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700'
  }
})
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset"
    :class="tone"
  >
    {{ status }}
  </span>
</template>
