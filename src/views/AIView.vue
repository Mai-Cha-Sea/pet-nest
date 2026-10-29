<script setup lang="ts">
/**
 * AI 对话页：所选宠物/会话、即时问答、云端历史、额度与失败恢复。
 * messages/requests 是云端快照，liveTurns 暂存本页已发出的问答；按 request_id 合并。
 * 任何轮询只读历史，不重新调用模型；同请求重试与新问题使用不同的 ID 策略。
 * 关键回归在 tests/views.test.ts 和 tests/api.test.ts。
 */
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getPets, history, usage, askAI } from '../lib/api'
import { configured } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import type { Pet, Conversation } from '../../shared/domain'
import Icon from '../components/Icon.vue'
import Notice from '../components/Notice.vue'
type Question = Parameters<typeof askAI>[0]
/**
 * 本页发送中的临时问答；已确认的 answer 即时展示，不等待下一次历史查询。
 */
interface LiveTurn {
  body: Question
  created_at: string
  status: 'pending' | 'succeeded' | 'failed'
  answer?: string
}
const route = useRoute(),
  pets = ref<Pet[]>([]),
  petId = ref(String(route.query.pet || '')),
  sessionId = ref(crypto.randomUUID() as string),
  messages = ref<Conversation[]>([]),
  requests = ref<Awaited<ReturnType<typeof history>>['requests']>([]),
  liveTurns = ref<LiveTurn[]>([]),
  question = ref(''),
  busy = ref(false),
  autoChecking = ref(false),
  loading = ref(false),
  error = ref(''),
  used = ref(0),
  retry = ref<Question>(),
  chat = ref<HTMLElement>(),
  historyOpen = ref(false)
/**
 * 合并当前会话的历史与即时消息，以 request_id:role 去重。
 * 保留本地已确认答案，让暂时滞后的历史响应不会使回答消失。
 */
const visible = computed(() => {
    const result = messages.value.filter((m) => m.session_id === sessionId.value)
    const keys = new Set(result.map((m) => `${m.request_id}:${m.role}`))
    for (const turn of liveTurns.value) {
      if (turn.body.session_id !== sessionId.value) continue
      for (const role of ['user', 'assistant'] as const) {
        const key = `${turn.body.request_id}:${role}`
        if (keys.has(key) || (role === 'assistant' && !turn.answer)) continue
        result.push({
          id: `live:${key}`,
          request_id: turn.body.request_id,
          session_id: turn.body.session_id,
          pet_id: turn.body.pet_id,
          role,
          content: role === 'user' ? turn.body.question : turn.answer!,
          created_at: turn.created_at,
        })
      }
    }
    return result
  }),
  pet = computed(() => pets.value.find((p) => p.id === petId.value))
/**
 * 服务端终态优先；本地已成功结果可以覆盖仍为 pending 的服务端快照。
 * 其余情况保留服务端状态，用于历史列表及是否需要继续只读轮询。
 */
const requestRows = computed(() => {
  const rows = new Map(requests.value.map((r) => [r.id, r]))
  for (const turn of liveTurns.value) {
    const saved = rows.get(turn.body.request_id)
    if (saved && (saved.status !== 'pending' || turn.status !== 'succeeded')) continue
    rows.set(turn.body.request_id, {
      id: turn.body.request_id,
      session_id: turn.body.session_id,
      question: turn.body.question,
      status: turn.status,
      error_code: null,
      created_at: turn.created_at,
    })
  }
  return [...rows.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
})
const sessions = computed(() => {
  const seen = new Set<string>()
  return requestRows.value.filter((r) => {
    if (seen.has(r.session_id)) return false
    seen.add(r.session_id)
    return true
  })
})
const currentStatus = computed(
  () => requestRows.value.find((r) => r.session_id === sessionId.value)?.status,
)
/**
 * 每次加载/切换宠物递增版本；只接收当前版本的异步结果。
 */
let generation = 0
/**
 * 刷新所选宠物的历史及今日额度。silent 用于后台同步，避免重置已展示回答。
 * 请求失败仅显示提示，liveTurns 保留；旧版本响应不能写回新选择的页面状态。
 */
async function reload(silent = false) {
  if (!configured || !petId.value) return
  const version = ++generation
  loading.value = !silent
  try {
    const [h, n] = await Promise.all([history(petId.value), usage()])
    if (version === generation) {
      messages.value = h.messages
      requests.value = h.requests
      used.value = n
      if (h.requests.some((r) => r.id === retry.value?.request_id && r.status === 'succeeded')) {
        retry.value = undefined
        error.value = ''
      }
      await nextTick()
      scroll()
    }
  } catch (e) {
    if (version === generation && (!silent || !error.value))
      error.value = silent
        ? '历史或额度暂未同步，已收到的回答仍会显示。稍后可点击“刷新历史与额度”。'
        : errorMessage(e)
  } finally {
    if (version === generation) loading.value = false
  }
}
/**
 * DOM 更新后滚动至最近消息；无 scrollTo 的测试环境采用 scrollTop 回退。
 */
function scroll() {
  if (!chat.value) return
  if (typeof chat.value.scrollTo === 'function')
    chat.value.scrollTo({ top: chat.value.scrollHeight, behavior: 'smooth' })
  else chat.value.scrollTop = chat.value.scrollHeight
}
watch([visible, busy], () => nextTick(scroll), { flush: 'post' })
/**
 * 已知 pending 且当前不在发送时，每 2 秒只读历史，最多检查 2 分钟。
 * 切换状态/宠物/会话或组件卸载时停止后续调度；这不取消已受理的后端调用。
 * 先前开始的 reload 仍受 generation 保护。
 */
watch([currentStatus, busy, petId, sessionId], ([status, sending], _old, onCleanup) => {
  if (status !== 'pending' || sending) return
  autoChecking.value = true
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  const started = Date.now()
  const check = async () => {
    await reload(true)
    if (stopped) return
    if (currentStatus.value === 'pending' && Date.now() - started < 120000)
      timer = setTimeout(check, 2000)
    else autoChecking.value = false
  }
  timer = setTimeout(check, 2000)
  onCleanup(() => {
    stopped = true
    autoChecking.value = false
    clearTimeout(timer)
  })
})
/**
 * 切换宠物先清除旧宠物的界面缓存并使旧加载失效，避免混入其他宠物数据。
 */
watch(petId, () => {
  generation++
  sessionId.value = crypto.randomUUID()
  messages.value = []
  requests.value = []
  liveTurns.value = []
  error.value = ''
  retry.value = undefined
  question.value = ''
  void reload()
})
onMounted(async () => {
  if (!configured) return
  loading.value = true
  try {
    pets.value = await getPets()
    if (!pets.value.some((p) => p.id === petId.value)) petId.value = pets.value[0]?.id || ''
    else await reload()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
})
/**
 * 创建本页新的会话 UUID；服务端在首个问题被受理时才建立该会话。
 */
function newSession() {
  sessionId.value = crypto.randomUUID()
  question.value = ''
  retry.value = undefined
  error.value = ''
  historyOpen.value = false
}
/**
 * 切换到已有会话，不重新请求模型；可见消息从本宠物历史中筛选。
 */
function chooseSession(id: string) {
  sessionId.value = id
  error.value = ''
  question.value = ''
  retry.value = undefined
  historyOpen.value = false
  nextTick(scroll)
}
/**
 * 把失败问题放回输入框并放弃原重试标识；下次提交视为新问题，可能再次占次。
 */
function editRetry() {
  if (!retry.value || busy.value) return
  question.value = retry.value.question
  retry.value = undefined
  error.value = ''
}
/**
 * 发送新问题，或在 same=true 时复用 retry 的完整请求以查询/重试同一操作。
 * busy 防止连点；当天额度只是 UI 提示，最终由服务端事务裁决。
 * 成功立即保存 answer 到 liveTurns，后台刷新历史；不确定失败时保留原 request_id。
 */
async function send(same = false) {
  if (busy.value || !petId.value || (!same && (!!retry.value || used.value >= 20))) return
  const body =
    same && retry.value
      ? retry.value
      : {
          pet_id: petId.value,
          session_id: sessionId.value,
          request_id: crypto.randomUUID(),
          question: question.value.trim(),
        }
  if (!body.question || body.question.length > 2000) {
    error.value = '请填写 1–2000 字的问题。'
    return
  }
  busy.value = true
  error.value = ''
  retry.value = body
  let turn = liveTurns.value.find((t) => t.body.request_id === body.request_id)
  if (!turn) {
    liveTurns.value.push({ body, created_at: new Date().toISOString(), status: 'pending' })
    turn = liveTurns.value[liveTurns.value.length - 1]!
  }
  turn.status = 'pending'
  question.value = ''
  try {
    const result = await askAI(body)
    // Display the acknowledged response immediately; history may lag or be unavailable.
    turn.answer = result.answer
    turn.status = 'succeeded'
    if (typeof result.used === 'number') used.value = result.used
    retry.value = undefined
  } catch (e) {
    turn.status = e instanceof Error && e.message === 'REQUEST_PENDING' ? 'pending' : 'failed'
    error.value = errorMessage(e)
  } finally {
    busy.value = false
    void reload(true)
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">A LITTLE MORE UNDERSTANDING</span>
      <h1>AI 健康助手<span class="heading-dot">.</span></h1>
      <p>结合它的日常，聊聊你关心的养护问题。</p>
    </div>
    <span class="usage-badge"><Icon name="ai" :size="16" />今日已用 {{ used }} / 20 次</span>
  </div>
  <div class="ai-safety">
    <Icon name="deworming" :size="20" /><span
      >养护咨询参考，不替代兽医诊断。若出现大量出血、抽搐或疑似误食异物，请立即联系线下宠物医院。</span
    >
  </div>
  <div class="chat-layout">
    <aside class="panel chat-history" :class="{ mobileOpen: historyOpen }">
      <div class="section-heading">
        <h2>对话记录</h2>
        <button class="icon-button" :disabled="busy" aria-label="新建对话" @click="newSession">
          <Icon name="plus" />
        </button>
      </div>
      <label
        >选择宠物<select v-model="petId" :disabled="busy">
          <option value="" disabled>选择宠物</option>
          <option v-for="p in pets" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select></label
      ><button class="button secondary full" :disabled="busy || !petId" @click="newSession">
        <Icon name="plus" :size="16" />开启新对话
      </button>
      <div class="history-caption">最近 30 天 · 云端保存</div>
      <button
        v-for="s in sessions"
        :key="s.session_id"
        class="session-item"
        :class="{ active: s.session_id === sessionId }"
        :disabled="busy"
        @click="chooseSession(s.session_id)"
      >
        <span>{{ s.question }}</span
        ><small
          >{{ new Date(s.created_at).toLocaleDateString('zh-CN') }} ·
          {{
            s.status === 'failed' ? '有失败请求' : s.status === 'pending' ? '处理中' : '已保存'
          }}</small
        >
      </button>
      <p v-if="!sessions.length" class="muted compact">新对话会出现在这里。</p>
      <button class="text-button" :disabled="loading || busy || !petId" @click="reload()">
        刷新历史与额度
      </button>
    </aside>
    <section class="chat-panel">
      <div class="chat-topbar">
        <div class="row">
          <span class="ai-mark"><Icon name="ai" :size="20" /></span>
          <div>
            <strong>{{ pet ? `${pet.name} 的养护小助手` : '宠物养护小助手' }}</strong
            ><small>{{ pet ? '基于档案与近 30 天记录 · 不读取图片' : '先选择一位小朋友' }}</small>
          </div>
        </div>
        <button
          class="icon-button mobile-history-button"
          aria-label="查看历史对话"
          @click="historyOpen = !historyOpen"
        >
          <Icon name="clock" />
        </button>
      </div>
      <div ref="chat" class="chat-messages" aria-live="polite">
        <div v-if="!visible.length" class="chat-empty">
          <div class="large-ai-icon"><Icon name="ai" :size="36" /></div>
          <h2>关于它，你想了解些什么？</h2>
          <p>选择宠物后开始对话。<br />我会结合你真实记录的资料，提供养护参考。</p>
          <div class="suggestions">
            <button
              v-for="q in [
                '结合最近的喂食记录，有什么需要留意？',
                '我该如何记录它的体重变化？',
                '日常观察时应该关注哪些变化？',
              ]"
              :key="q"
              :disabled="busy"
              @click="question = q"
            >
              {{ q }}<Icon name="arrow" :size="15" />
            </button>
          </div>
          <RouterLink v-if="!pets.length && !loading" to="/pets/new" class="text-button"
            >先创建一份宠物档案 →</RouterLink
          >
        </div>
        <div v-for="m in visible" :key="m.id" class="message" :class="m.role">
          <span class="message-avatar"
            ><Icon :name="m.role === 'assistant' ? 'ai' : 'user'" :size="18"
          /></span>
          <div>
            <span class="message-label">{{ m.role === 'assistant' ? '小窝养护助手' : '我' }}</span>
            <div class="message-bubble">{{ m.content }}</div>
          </div>
        </div>
        <div v-if="busy || autoChecking" class="message assistant thinking-message" role="status">
          <span class="message-avatar"><Icon name="ai" :size="18" /></span>
          <div>
            <span class="message-label">小窝养护助手</span>
            <div class="message-bubble thinking-bubble">
              <span><Icon name="loading" class="spin" :size="16" />正在思考…</span>
              <small>正在结合档案和近期记录整理回答，请稍候。</small>
            </div>
          </div>
        </div>
        <p v-else-if="loading" class="loading-row" role="status">
          <Icon name="loading" class="spin" :size="18" />正在读取云端历史…
        </p>
        <p v-if="currentStatus === 'failed' && !busy" class="notice">
          本轮提问未完成，请查看下方提示。检查或重试同一请求不会重复扣次。
        </p>
        <p v-if="currentStatus === 'pending' && !busy" class="notice">
          {{
            autoChecking
              ? '请求仍在处理中，正在自动检查回答。'
              : '暂未收到完整回答，请检查或重试同一请求。'
          }}
        </p>
      </div>
      <div class="chat-composer">
        <Notice :error="error" />
        <div v-if="retry && !busy" class="retry-actions">
          <button class="text-button" @click="send(true)">检查 / 重试同一请求（不重复扣次）</button
          ><button class="text-button" @click="editRetry">编辑后重新提问（新的计次）</button>
        </div>
        <form @submit.prevent="send()">
          <textarea
            v-model="question"
            rows="3"
            maxlength="2000"
            :disabled="busy"
            placeholder="描述你的问题，例如：它这两天吃得比平时少…"
            aria-label="养护问题"
            @keydown.ctrl.enter.prevent="send()"
          ></textarea>
          <div class="row between">
            <span class="muted compact">{{ question.length }} / 2000 · Ctrl + Enter 发送</span
            ><button
              class="button"
              :disabled="busy || !configured || !petId || !question.trim() || used >= 20 || !!retry"
              type="submit"
            >
              <Icon name="send" :size="17" />{{ busy ? '思考中…' : '发送' }}
            </button>
          </div>
        </form>
        <p class="chat-disclaimer">
          以上建议仅供参考，不构成诊疗意见。如症状持续或加重，请及时联系线下宠物医院。
        </p>
      </div>
    </section>
  </div>
</template>
