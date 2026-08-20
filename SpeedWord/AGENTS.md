# 极速识词 V4.1 - Agent Rules

## 项目目标
这是一个面向少量英语教师的一体机课堂互动软件。核心目标是让教师快速创建词包，并通过游戏化方式帮助学生学习英语。

## 技术栈
- Vue 3 + TypeScript + Vite
- Electron（主进程 / Preload / Renderer 三层架构）
- SQLite（sql.js WASM，本地文件存储）
- Pinia 状态管理
- 本地资产缓存（图片 / 音频）
- AI Provider / Dictionary Provider / Image Provider 抽象

## 默认 Coding Agent
- Agnes 2.5 Flash
- 仅用于开发阶段，不得写死到产品业务逻辑

## 核心原则
1. 先理解再修改。禁止看到需求就直接重写模块。
2. 先定位根因，再修复。
3. 不随意重写现有架构。
4. 不删除现有功能来规避错误。
5. 修改后必须 build + test。

## Electron IPC
- Renderer 不直接调用第三方 AI API
- IPC 只能传 Plain Object / Primitive
- 禁止 Vue Proxy、reactive/ref、Error、Response、Request、Headers、Buffer、Blob、File 等跨 IPC
- 重新生成图片只传 `contentId + customInstruction`
- 保存设置时只传经过明确映射的字符串/布尔值/普通对象

## 数据库
- SQLite 是核心事实来源
- 核心保存使用事务（BEGIN → INSERT → 校验数量 → COMMIT）
- 保存后验证数量与输入一致
- 图片/音频是增强数据，不能阻塞核心词条保存
- 任何核心词条失败都 ROLLBACK

## AI Provider
- 不把 Agnes 写死到业务逻辑
- 外部 API 通过 Service / Provider 抽象
- API Key 只在 Main Process + safeStorage 处理
- 日志只记录 `apiKeyConfigured`、长度以及掩码后的前后少量字符

## 图片系统
- Prompt 集中在 `electron/image-prompt-builder.ts`
- 默认统一"极速识词·课堂绘本风"（GLOBAL_IMAGE_STYLE）
- 教师修改/锁定的图片不得自动覆盖
- builtin 只作为离线兜底
- 图片来源优先级：teacher > selected > ai > curated > builtin
- 重新生成图片只传 contentId + customInstruction

## 智能词包保存
- 核心词条先保存（事务），图片/音频异步补充
- 禁止出现 generatedItems 有内容但 editor.words 为空的双状态源
- 保存失败必须有明确错误提示，禁止 silent catch

## 错误处理
- 禁止 silent catch
- 所有失败转换为结构化错误：{ code, message, status, detail }
- 区分 401/403/404/429/500-503/网络错误/timeout

## 完成标准
每次改动后输出：
1. 根因
2. 修改文件
3. 关键实现
4. Build 结果
5. 测试结果
6. 是否影响既有功能
7. 剩余风险
