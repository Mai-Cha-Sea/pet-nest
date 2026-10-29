<script setup lang="ts">
/**
 * 统一的业务图标别名与 Lucide 组件映射；页面用别名而非依赖图标库内部名字。
 * 纯装饰图标隐藏于辅助技术，按钮的可访问名称应由调用页面提供。
 */
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
  UsersRound,
  MessageCircle,
  Bookmark,
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
  community: UsersRound,
  comment: MessageCircle,
  bookmark: Bookmark,
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
