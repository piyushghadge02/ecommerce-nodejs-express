<script setup>
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-vue-next'
import { dismissToast, toasts } from '../stores/toast.js'

const styles = {
  success: { icon: CheckCircle2, ring: 'ring-emerald-200 dark:ring-emerald-900', iconCls: 'text-emerald-600 dark:text-emerald-400' },
  error: { icon: XCircle, ring: 'ring-red-200 dark:ring-red-900', iconCls: 'text-red-600 dark:text-red-400' },
  warning: { icon: AlertTriangle, ring: 'ring-amber-200 dark:ring-amber-900', iconCls: 'text-amber-600 dark:text-amber-400' },
  info: { icon: Info, ring: 'ring-indigo-200 dark:ring-indigo-900', iconCls: 'text-indigo-600 dark:text-indigo-400' },
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
    aria-live="polite"
  >
    <div
      v-for="t in toasts"
      :key="t.id"
      class="pointer-events-auto flex items-start gap-3 rounded-xl border border-stone-200 bg-white p-3.5 shadow-lg ring-1 dark:border-stone-700 dark:bg-stone-900"
      :class="styles[t.type]?.ring ?? styles.info.ring"
      role="status"
    >
      <component
        :is="styles[t.type]?.icon ?? styles.info.icon"
        class="mt-0.5 h-5 w-5 shrink-0"
        :class="styles[t.type]?.iconCls ?? styles.info.iconCls"
        aria-hidden="true"
      />
      <p class="min-w-0 flex-1 text-sm text-stone-800 dark:text-stone-100">{{ t.message }}</p>
      <button
        class="rounded p-0.5 text-stone-400 transition-soft hover:bg-stone-100 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300"
        aria-label="Dismiss notification"
        @click="dismissToast(t.id)"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
