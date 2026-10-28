<script setup lang="ts">
import {
  PawPrint,
  LayoutGrid,
  Sparkles,
  UserRound,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  ChevronRight,
  Heart,
  Clock3,
  Utensils,
  Weight,
  ShieldCheck,
  Bath,
  Pill,
  TriangleAlert,
  Settings,
  LogOut,
  Menu,
  X,
  Send,
  ImagePlus,
  Trash2,
  Pencil,
  Check,
  LoaderCircle,
  Leaf,
  CalendarDays,
} from 'lucide-vue-next'
defineProps<{ name: string; size?: number }>()
const icons: Record<string, typeof PawPrint> = {
  paw: PawPrint,
  grid: LayoutGrid,
  ai: Sparkles,
  user: UserRound,
  plus: Plus,
  arrow: ArrowUpRight,
  back: ArrowLeft,
  right: ChevronRight,
  heart: Heart,
  clock: Clock3,
  feeding: Utensils,
  weight: Weight,
  deworming: ShieldCheck,
  bath: Bath,
  medication: Pill,
  incident: TriangleAlert,
  settings: Settings,
  logout: LogOut,
  menu: Menu,
  close: X,
  send: Send,
  image: ImagePlus,
  trash: Trash2,
  edit: Pencil,
  check: Check,
  loading: LoaderCircle,
  leaf: Leaf,
  calendar: CalendarDays,
}
</script>
<template>
  <component
    :is="icons[name] || PawPrint"
    :size="size || 20"
    :stroke-width="1.7"
    aria-hidden="true"
  />
</template>
