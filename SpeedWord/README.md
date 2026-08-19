# 极速识词（课堂互动版）· V4 Windows 桌面版

面向 Windows 一体机 / 投影大屏的英语课堂单词卡互动软件。教师只需粘贴单词、词组或句子，系统自动识别类型并补全音标、释义、例句与图片；课堂支持 8 种玩法与 Session 级班级反馈；**AI 只是内容生成助手，不是课堂运行依赖** —— 断网、无 AI 时已准备好的词包仍可完整教学。

技术栈：**Vue 3 + TypeScript + Vite + Electron + Pinia + SQLite（sql.js / WASM）+ electron-builder**。

## 功能一览

| 模块 | 说明 |
|---|---|
| 🏠 首页 | 第一视觉重点 = 「开始课堂」，常用入口直达 |
| 📚 我的词包 | 词包列表 / 新建 / 删除，双击进入词条编辑 |
| ✨ 智能创建 | 粘贴多行内容 → 自动识别类型 → 智能补全（词典 + AI + 图片） |
| 📝 词条编辑器 | 逐字段查看/编辑：文字、音标、词性、中文释义、例句、图片、音频；重新生成 / 选图 / 上传 / 锁定 |
| 🖼️ 图片素材 | 内置图 + 图片库管理（选择 / 上传 / 删除） |
| 🎮 课堂游戏 | 8 种玩法，选择词包即开始全屏课堂 |
| 🔁 复习池 | 「重点复习」的课内词条自动进入本地复习池，可换玩法重练 |
| ⚙️ 智能服务 | API 配置（统一或高级独立 Text/Dictionary/Image），密钥经主进程 safeStorage 加密 |
| 💾 备份恢复 | 单词包 `.swpack` 导出/导入，或全量备份/恢复；导入失败可回滚 |

### 8 种课堂玩法
快速识词 ⚡ · 看图猜词 🖼️ · 选择挑战 🎯 · 英译中 🇬🇧 · 中译英 🇨🇳 · 情境猜词 🧩 · 随机挑战 🎲 · 翻牌记忆 🃏

课堂同时提供**连击反馈**（combo）与 Session 级班级反馈：全班掌握 / 部分需要加强 / 重点复习 / 未反馈。**重点复习自动进入复习池**。

### 内容类型自动识别
粘贴 `apple` / `look after` / `take care of` / `piece of cake` / `This is my book.` 等，自动识别为：
`word`（单词）· `phrase`（词组）· `phrasal_verb`（短语动词）· `expression`（习语表达）· `sentence`（句子）

## 快速开始

```bash
# 安装依赖（中国大陆用户建议配镜像，见 docs/开发环境说明.md）
npm install

# 本地运行（构建 + 启动 Electron）
npm start

# 仅运行测试（88 项纯逻辑单测，无需 Electron）
npm test

# 类型检查
npm run typecheck
```

首次启动后：
1. **智能服务** 页填入你的 API 配置（可选，但建议 —— 用于自动补全与图片生成）。
2. **智能创建** 粘贴一列单词 → 自动补全 → 修正/锁定 → 保存。
3. **课堂游戏** 选择词包和玩法 → 开始课堂 → 全屏 → 完成反馈。

> 没有 API Key 也能用：内置本地 IPA 词典提供音标，内置 29 张标准素材图；教师可自行上传图片、手填释义。

## 构建 Windows 安装包

```bash
npm run dist:win        # NSIS 安装版 + Portable 绿色版（输出到 release/）
npm run dist:portable   # 仅绿色版
```

产物示例：
- `release/极速识词-Setup-4.0.0.exe`（NSIS 安装版，可自选安装目录、创建桌面快捷方式）
- `release/极速识词-Portable-4.0.0.exe`（绿色版，解压即用）

中国大陆网络建议预置镜像变量（见 `docs/开发环境说明.md`），否则 electron / electron-builder 二进制可能下载失败。

## 数据与隐私

- 数据存于 `%APPDATA%/极速识词/speedword.db`（SQLite / sql.js WASM），本地离线可用。
- **API Key 永不写入源码与数据库**：由 Electron 主进程 `safeStorage`（Windows DPAPI）加密保存；渲染进程仅持有「已配置」布尔标记与占位符，拿不到明文。
- 图片素材存于 `%APPDATA%/极速识词/media/`。
- 备份 `.swpack` 为 zip 格式：`manifest.json + words.json + images/ + audio/ + metadata/`。

## 安全设计

- `contextIsolation: true`、`nodeIntegration: false`，渲染进程无 Node 能力。
- 仅通过 `preload.ts` 暴露白名单 IPC（`window.api`）。
- 外部内容（网络图片/音频）只作为 `<img>`/`<audio>` 资源渲染，**绝不作为脚本执行**。
- API 调用全部由主进程完成，Key 不外泄到页面。

## 项目结构

```
SpeedWord/
├─ src/                  # Vue 渲染端
│  ├─ views/             # 10 个模块页面（Home/Packs/SmartCreate/ItemEditor/Media/GameCenter/ReviewPool/Settings/Backup/Classroom）
│  ├─ stores/            # Pinia：packs / classroom / review / settings / ui / helpers
│  ├─ shared/            # 纯逻辑（渲染与主进程共用，可单测）：types / api / fieldstate / type-detect / ipa / uuid / sqljs.d.ts
│  │  └─ game/           # 课堂引擎：state-machine / queue / question
│  └─ services/          # enrichMerge（AI结果与人工状态合并）、tts（Web Speech）
├─ electron/             # Electron 主进程（CommonJS）
│  ├─ main.ts            # BrowserWindow（安全配置）+ sw:// 图片协议 + IPC 注册
│  ├─ preload.ts         # contextBridge 白名单
│  ├─ db.ts              # SQLite 数据层（sql.js）
│  ├─ secure-store.ts    # safeStorage 密钥加密存储
│  ├─ ai.ts              # 统一 Provider：Text / Dictionary / Image
│  ├─ dictionary.ts      # 内置 IPA + Free Dictionary API + AI 词典
│  ├─ images.ts          # 图片引擎（builtin / api / ai / user）
│  ├─ enrich.ts          # 智能补全编排（词典→AI→图片）
│  ├─ backup.ts          # .swpack 导入导出 / 全量 dump-restore（可回滚）
│  └─ ipc.ts / util.ts
├─ assets/               # 内置词典（en_US/en_UK IPA）+ 29 张内置图 + icon.ico
├─ examples/             # 示例词包（.swpack）与示例数据
├─ scripts/              # prepare-assets / after-build / clean
├─ tests/                # 88 项纯逻辑单测（vitest，node 环境，无需 Electron）
└─ docs/                 # 开发环境说明 / API 配置说明
```

## 测试

```bash
npm test    # 88 项通过：类型识别 / 字段状态与锁定 / 课堂状态机 / 出题队列 / 8玩法出题 / IPA / 备份与回滚 / AI 配置链
npm run typecheck
npm run build
```

测试覆盖验收关键点：
- **字段状态机**：`locked` / `edited` 字段绝不被自动生成覆盖（验收 #6）
- **课堂状态机**：非法转移拒绝（快速连点保护）、锁机制（验收 #10）
- **备份**：`.swpack` 导入导出往返、损坏/版本过高回滚、全量 dump-restore（验收 #7）
- **出题**：8 玩法出题、干扰项不含目标词、方向随机确定性（验收 #9）

## 详细文档

- [开发环境说明](docs/开发环境说明.md) —— 依赖、镜像、脚本、常见问题
- [API 配置说明](docs/API配置说明.md) —— 统一/高级配置、本地 Ollama、安全存储、异常处理

## 许可证

MIT
