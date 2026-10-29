/**
 * 应用启动入口：先初始化认证，再安装路由并挂载 Vue。
 * 路由守卫等待 authPromise，避免首次加载把尚未恢复的会话误判为未登录。
 */
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { initAuth } from './stores/auth'
import './style.css'
import './p1.css'
initAuth()
createApp(App).use(router).mount('#app')
