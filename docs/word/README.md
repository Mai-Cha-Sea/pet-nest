# 四册 Word 手册

适用应用版本：0.2.0（P1）。文档编制日期：2026-10-29。面向用户、接手开发者、维护/审核管理员及测试人员，分别组织内容；原始 Markdown 和历史报告继续保留。

| 手册                                             | 主要内容                                                  | 可维护原稿                                                                      |
| ------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [用户使用说明](01_宠物小窝用户使用说明.docx)     | 注册登录、宠物、六类记录、AI、社区、绑定及常见问题        | [USER-GUIDE.md](../USER-GUIDE.md)                                               |
| [开发接手与维护指南](02_开发接手与维护指南.docx) | 获取 main、架构、代码入口、关键约束、维护与验证           | [02-development.md](../manuals/02-development.md)                               |
| [部署与内容审核指南](03_部署与内容审核指南.docx) | 环境和密钥、迁移/函数、Pages、短信、举报、评论和动态复核  | [03-operations.md](../manuals/03-operations.md)                                 |
| [测试与验收指南](04_测试与验收指南.docx)         | 分层验证、账号和脚本、业务闭环、证据、完整 101 项场景附录 | [04-testing.md](../manuals/04-testing.md)及 [TEST-MATRIX.md](../TEST-MATRIX.md) |

用户册是面向实际使用者的新编说明；其余三册依据 HANDOVER、DATABASE、DATABASE-FUNCTIONS、API、DEPLOYMENT、CLOUDFLARE-PAGES、SMS-SETUP、MODERATION、TESTING、TEST-MATRIX、GAP-FIXES、SOURCE-COMMENTS、SECRET-SAFETY 与 KNOWN-ISSUES 整理。技术原文和历史结果仍是追溯依据，不把多批检查合并写成新一次验收。

本次四册分别渲染为 9、6、8、21 页，共 44 页，已逐页检查中文、导航、页码、跨页表头、命令换行及横向附录。Word 编辑器和字体环境不同可能造成分页差异。已检查 DOCX 结构、101 个场景编号及本地链接；本机已知密钥和常见凭据格式未检出。以上是文档交付检查，没有重新运行云端业务或发布网站。

## 更新和重新生成

先修改对应 Markdown 原稿，再运行生成器。测试附录从 TEST-MATRIX.md 提取，保留原场景编号和结果边界；场景数变化时同步更新生成器中的数量核对，不能静默截断。

```powershell
python -m pip install -r scripts/requirements-docs.txt
python scripts/build-handbooks.py
```

要求 Python 3.10 及以上。文档依赖独立于前端 npm 依赖，正常运行 Web 应用无需安装它们。生成器不读取真实 .env、密钥或账号文件，不执行 SQL、云端测试、短信或部署。

生成后用 Word 或兼容的排版引擎导出检查稿，逐页检查目录导航、中文字体、页脚、表格、长路径/命令及横向附录；仅创建 DOCX 不算排版完成。检查稿、页图和原始日志留在被 Git 忽略的 test-results，不作为用户交付物。

本册不包含真实密码、API Key、验证码或管理员证据。源码和 Word 可以公开，平台访问和私人数据仍需安全交接。文件不会随前端构建发布到 Pages。
