/**
 * 协议版本和注册声明的共享入口，正文位于 src/content/legal.ts。
 * 正文版本调整需同时更新此处并新增数据库迁移；旧账号不能自动补签。
 * accepted 表示页面提交的声明，不是阅读证明或身份授权凭据。
 */
// Change these versions when the corresponding published document changes.
export const TERMS_VERSION = '2026-10-29'
export const PRIVACY_VERSION = '2026-10-29'
/**
 * 生成本次页面提交的版本声明；调用前由注册页要求用户主动勾选同意。
 */
export const registrationConsent = () => ({
  accepted: true,
  terms_version: TERMS_VERSION,
  privacy_version: PRIVACY_VERSION,
})
