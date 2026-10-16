<script setup>
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps({
  page: { type: Number, required: true },
  totalPages: { type: Number, required: true },
  total: { type: Number, default: 0 },
  pageSize: { type: Number, default: 20 },
})

const emit = defineEmits(['update:page'])

/** Compact window of page numbers around the current page. */
const pages = computed(() => {
  const total = Math.max(1, props.totalPages)
  const cur = Math.min(Math.max(1, props.page), total)
  const span = 2
  const start = Math.max(1, cur - span)
  const end = Math.min(total, cur + span)
  const out = []
  for (let p = start; p <= end; p++) out.push(p)
  return { out, start, end, total, cur }
})

function go(p) {
  if (p >= 1 && p <= props.totalPages && p !== props.page) emit('update:page', p)
}

const rangeText = computed(() => {
  if (!props.total) return '0 results'
  const from = (props.page - 1) * props.pageSize + 1
  const to = Math.min(props.total, props.page * props.pageSize)
  return `Showing ${from}–${to} of ${props.total}`
})

const btn =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-stone-200 bg-white px-2 text-sm font-medium text-stone-700 transition-soft hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-800 dark:disabled:hover:bg-stone-900'
</script>

<template>
  <div class="flex flex-col items-center justify-between gap-3 sm:flex-row">
    <p class="text-sm text-stone-500 dark:text-stone-400">{{ rangeText }}</p>
    <nav class="flex items-center gap-1.5" aria-label="Pagination">
      <button :class="btn" :disabled="page <= 1" aria-label="Previous page" @click="go(page - 1)">
        <ChevronLeft class="h-4 w-4" />
      </button>

      <button v-if="pages.start > 1" :class="btn" @click="go(1)">1</button>
      <span v-if="pages.start > 2" class="px-1 text-sm text-stone-400 dark:text-stone-500">…</span>

      <button
        v-for="p in pages.out"
        :key="p"
        :class="[btn, p === page ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 hover:text-white' : '']"
        :aria-current="p === page ? 'page' : undefined"
        @click="go(p)"
      >
        {{ p }}
      </button>

      <span v-if="pages.end < pages.total - 1" class="px-1 text-sm text-stone-400 dark:text-stone-500">…</span>
      <button v-if="pages.end < pages.total" :class="btn" @click="go(pages.total)">
        {{ pages.total }}
      </button>

      <button
        :class="btn"
        :disabled="page >= totalPages"
        aria-label="Next page"
        @click="go(page + 1)"
      >
        <ChevronRight class="h-4 w-4" />
      </button>
    </nav>
  </div>
</template>
