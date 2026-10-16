<script setup>
import { computed } from 'vue'
import { Cable, Headphones, Keyboard, LampDesk, Package } from 'lucide-vue-next'

/**
 * Offline-safe product placeholder: a soft-tinted tile with a
 * category-appropriate Lucide icon. No external images are used,
 * so nothing breaks without network access.
 */
const props = defineProps({
  category: { type: String, default: '' },
  title: { type: String, default: '' },
  size: { type: String, default: 'md' }, // sm | md | lg
})

const meta = computed(() => {
  switch ((props.category || '').toLowerCase()) {
    case 'peripherals':
      return { icon: Keyboard, tint: 'bg-indigo-50 text-indigo-500' }
    case 'audio':
      return { icon: Headphones, tint: 'bg-violet-50 text-violet-500' }
    case 'cables':
      return { icon: Cable, tint: 'bg-sky-50 text-sky-500' }
    case 'office':
      return { icon: LampDesk, tint: 'bg-amber-50 text-amber-500' }
    default:
      return { icon: Package, tint: 'bg-stone-100 text-stone-400' }
  }
})

const sizes = {
  sm: 'h-12 w-12 rounded-lg',
  md: 'h-24 w-full rounded-xl',
  lg: 'h-40 w-full rounded-xl',
}
const iconSizes = { sm: 'h-5 w-5', md: 'h-10 w-10', lg: 'h-14 w-14' }
</script>

<template>
  <div
    class="flex items-center justify-center"
    :class="[meta.tint, sizes[size] ?? sizes.md]"
    role="img"
    :aria-label="title || 'Product image placeholder'"
    :title="title"
  >
    <component :is="meta.icon" :class="iconSizes[size] ?? iconSizes.md" aria-hidden="true" />
  </div>
</template>
