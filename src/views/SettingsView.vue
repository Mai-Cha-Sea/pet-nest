<script setup lang="ts">
/**
 * 可匿名阅读的连接说明、隐私入口和版本信息；登录后可退出及触发清理。
 * 显示“配置已加载”只说明存在前端变量，不作为云端连接成功的证据。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { signOut, session } from '../stores/auth'
import { configured } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { cleanup } from '../lib/api'
import Notice from '../components/Notice.vue'
import { version as appVersion } from '../../package.json'
const router = useRouter(),
  error = ref(''),
  busy = ref(false),
  status = ref('')
/**
 * 退出成功后跳转登录；失败保留当前页以显示错误。
 */
async function logout() {
  busy.value = true
  try {
    await signOut()
    router.replace('/auth')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
/**
 * 尽力请求处理本人清理队列；提示“已尝试”，不将请求完成等同于所有对象已删除。
 */
async function clean() {
  busy.value = true
  await cleanup()
  status.value = '已尝试提交后台清理；待处理文件可在下一次登录时重试。'
  busy.value = false
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">MAKE YOURSELF AT HOME</span>
      <h1>设置与帮助<span class="heading-dot">.</span></h1>
      <p>安心地记录，也清楚地了解数据去向。</p>
    </div>
  </div>
  <Notice :error="error" :success="status" />
  <div class="settings-sections">
    <section class="panel">
      <h2>连接状态</h2>
      <p>
        {{
          configured
            ? 'Supabase 前端配置已加载；实际连接结果以登录及读写操作为准。'
            : '当前为未配置预览。尚未接入数据库与 AI，页面不会保存示例数据。'
        }}
      </p>
      <ol v-if="!configured">
        <li>复制根目录 .env.example 为 .env.local，填写 Supabase URL 和公开密钥。</li>
        <li>按 README 执行数据库迁移并部署 Edge Functions。</li>
        <li>在 Edge Secrets 设置 DeepSeek 密钥与允许访问的前端域名，然后重启开发服务器。</li>
      </ol>
      <RouterLink v-if="!session" to="/auth" class="button secondary">前往登录</RouterLink>
    </section>
    <section class="panel">
      <h2>隐私与数据</h2>
      <p class="legal-links">
        <RouterLink to="/terms">查看完整用户协议</RouterLink
        ><RouterLink to="/privacy">查看完整隐私政策</RouterLink>
      </p>
      <p>
        宠物档案、日常记录、私有头像和异常图片、AI 对话仅本人可访问。密码由 Supabase Auth
        管理。图片使用私有存储，查看链接短时有效，请不要转发。
      </p>
      <p>
        主动发布到宠友社区的昵称、配文、标签、图片和评论，会向已登录的社区成员展示。关联宠物只分享名称，不公开档案或健康记录。当前使用词库检查文字，不识别图片中的文字或画面；发现不当内容可举报。
      </p>
      <p>
        向 AI 提问时，会将所选宠物资料、最近 30 天记录摘要和当前会话最近 10 轮成功对话发送给
        DeepSeek。请勿填写身份证、地址、电话等无关敏感信息。当前 AI 不分析上传图片。
      </p>
      <p>
        界面仅展示最近 30 天 AI
        对话；默认并不自动删除更早的云端调用审计记录。删除宠物会级联删除其所有记录、会话和调用明细，关联图片进入后台清理队列。
      </p>
      <p>
        每日 AI 限额按北京时间 00:00
        重置；每个已受理的新请求占用一次额度，服务失败也计次。同一请求标识重试不会重复扣次。实际模型
        token 由服务端记录。
      </p>
      <button v-if="session" class="button secondary" :disabled="busy" @click="clean">
        重试清理待删除图片
      </button>
    </section>
    <section class="panel">
      <h2>关于宠物小窝</h2>
      <p>版本 {{ appVersion }} · P1 宠物记录与社区版。为每一个小生命，记录每一天。</p>
      <p>
        本应用用于养护记录与咨询参考，不提供兽医诊断、在线处方或用药推荐。大量出血、抽搐、疑似误食异物等情况，请立即联系或前往线下宠物医院。
      </p>
    </section>
    <section v-if="session" class="panel">
      <h2>账号</h2>
      <p>{{ session.user.email }}</p>
      <button class="button secondary" :disabled="busy" @click="logout">
        {{ busy ? '处理中…' : '退出登录' }}
      </button>
    </section>
  </div>
</template>
