# API 配置说明（智能服务设置）

本软件把 AI 当作**内容生成助手**：自动补全音标之外的中文释义、教学例句、记忆提示、图片场景等。
它不是课堂运行依赖 —— 没有 AI / 断网时，已准备好的词包仍可正常教学。

## 打开方式

左侧导航 →「⚙️ 智能服务」。

## 三种工作模式

| 模式 | 说明 | 典型场景 |
|---|---|---|
| 云端 | 走远程 API（默认 OpenAI 兼容） | 教师有 API Key |
| 本地 | 指向本机/内网 API（如 Ollama） | 内网可访问 Ollama |
| 关闭 | 完全不调用 AI | 纯离线课堂 |

软件在「本地」模式且未配置 Ollama 时**照常运行**：词典走内置 IPA + Free Dictionary API（联网），图片走内置图/图片库/本地上传。

## 统一配置（默认界面）

只填一套，Text / Image / Dictionary 都复用：

- **服务商预设**：`Agnes AI`（国内直连，一键填充）或 `自定义（OpenAI 兼容）`—— 软件不硬编码任何服务商，预设只是便捷填充，可随时改
- **服务商**：OpenAI 兼容 / 其它（模型地址格式一致即可）
- **API 地址（baseUrl）**：例如 `https://api.agnes-ai.cn/v1`、`https://api.openai.com/v1`、Ollama 的 `http://localhost:11434/v1`
  - 保存时自动归一化：去首尾空白、去尾部 `/`、保留已有 `/v1`、缺失时补一个 `/v1`（绝不重复追加）
- **API Key**：`●` 掩码输入；已保存时显示「已配置」占位，不再显示明文
- **文本模型**：例如 `agnes-2.5-flash`、`gpt-4o-mini`、`qwen2.5:7b`（Ollama）
- **图片模型**：例如 `agnes-image-2.1-flash`、`dall-e-3`、Ollama 的 `stable-diffusion` 等（兼容接口）

### Agnes AI 预设

- 国内：`https://api.agnes-ai.cn/v1`
- 国际：`https://apihub.agnes-ai.com/v1`
- 备用：`https://apihub.agnes-ai.cn/v1`
- 默认模型：文本 `agnes-2.5-flash`，图片 `agnes-image-2.1-flash`

选择预设后可在页面切换「国内 / 国际 / 备用」区域；URL 自动更新。

### 测试连接

页面提供三个按钮，测试前会**先保存当前表单**（保证测的是屏幕上看到的配置），然后**真实调用接口**：

| 按钮 | 行为 |
|---|---|
| 测试文本服务 | `POST {baseUrl}/chat/completions`，n=1 最小请求 |
| 测试图片服务 | `POST {baseUrl}/images/generations`，真实生成 1 张（可能少量计费） |
| 测试全部 | 文本与图片并行独立执行，图片失败**不影响**文本结果 |

结果卡片显示：模型 / HTTP 状态码 / 实际端点 / 耗时 / 针对性建议（如 401 → 检查 Key、404 → 检查 /v1 与模型名）。

## 高级配置（独立 Text / Dictionary / Image）

默认界面是「一个 URL + 一个 Key + 文本模型 + 图片模型」。若你的词典、文本、图片分属不同服务，可打开高级开关，为三者分别填 URL / Key / Model。独立配置缺失的字段会自动回退到统一配置。

> 各 Key 分别存于独立的 safeStorage 槽位（`main` / `text` / `image` / `dictionary`），互不混用。

## 词典策略

`自动（auto）` 优先级：
1. **内置本地 IPA 词典**（`assets/dictionary/en_US.txt`、`en_UK.txt`）—— 断网也有音标；
2. **Free Dictionary API**（联网时在线补充词形、词性、英文释义、例句）；
3. **AI**：当上面都没有时，由 AI 教学化补全（中文释义、适合学生的英文解释、课堂例句、记忆提示）。

`词典（dictionary）` 独立服务可填 Oxford/Cambridge 或自定义词典 API（高级配置中启用独立 Dictionary）。

**AI 不是音标的唯一权威来源**：内置 IPA 数据永远优先；AI 只负责「教学化内容」，不负责唯一事实来源。

## 密钥安全存储（关键设计）

- **API Key 永不写入源码**，也不以明文进数据库。
- 保存时由主进程 `safeStorage`（Windows 上基于 DPAPI）加密，密文 base64 字符串存入 `ai_provider_settings` 表。
- 加解密走异步包装 `encryptStringAsync / decryptStringAsync`（`electron/secure-store.ts`），读取时若发现旧格式/兜底格式会自动**重加密升级**（`shouldReEncrypt`）。
- 渲染进程（页面）只看到 `hasKey: true/false` 与掩码占位，**永远拿不到明文**。
- AI 请求全部由主进程发出（`electron/ai.ts`），页面无法直接调用第三方 API。
- 若系统无法加密（极少见），兜底为弱混淆并标记 `plain:`，避免崩溃；Windows 下正常走 DPAPI。

## 渲染端 IPC 边界

- 渲染进程通过 `window.electronAPI.ai`（preload `contextBridge` 白名单暴露）访问 AI 配置链：
  `saveConfig(config, keys?)` / `getConfig()` / `testText()` / `testImage()` / `generateText(prompt)` / `generateImage(prompt)`。
- **绝不暴露 `ipcRenderer`**；`contextIsolation=true`、`nodeIntegration=false`。
- 所有参数与返回值均为 **Structured-Clone 安全**的纯普通对象/字符串/数字 —— 绝不把 Vue ref/reactive Proxy、Error、Buffer 等传过 IPC（否则报 `An object could not be cloned`）。
- 保存后主进程**回读**配置返回给渲染端，前端以实际持久化结果为准（`hasKey` 等状态不会失同步）。
- 启动时应用自动读取配置，首页/侧边栏显示「智能服务已连接 / 未配置」。

## Provider 接口

统一抽象（`electron/ai.ts`）：

```
TextProvider.complete(messages, opts?)      → string       （文本补全）
ImageProvider.generate(prompt, opts?)      → { b64 | url } （图片生成）
testTextService(cfg) / testImageService(cfg) → ServiceTestResult
ServiceTestResult = { service, success, code, message, status?, endpoint?, model?, durationMs, suggestion? }
```

新增一家供应商只需实现对应接口，无需改动业务编排（`electron/enrich.ts`）。

## 错误分类（测试/生成返回结构化结果）

| code | 触发 | 建议 |
|---|---|---|
| `ok` | HTTP 2xx 成功 | — |
| `ai_not_configured` / `ai_no_key` | 未填 URL/模型 / 未填 Key | 到「智能服务设置」填写并保存 |
| `ai_http` + `400` | 请求参数/模型名有误 | 检查模型名、URL、尺寸 |
| `ai_http` + `401` | Key 无效/过期 | 重新填写并保存 Key |
| `ai_http` + `403` | 权限不足 | 核对 Key 是否有该模型权限 |
| `ai_http` + `404` | 接口/模型不存在 | 确认 URL 以 `/v1` 结尾、模型名正确 |
| `ai_http` + `429` | 限流/额度用完 | 稍后重试或检查余额 |
| `ai_http` + `500/502/503/504` | 服务端故障 | 稍后重试 |
| `ai_dns` | 域名无法解析 | 检查 URL、网络、是否需要代理 |
| `ai_timeout` | 请求超时 | 网络不稳，稍后重试 |
| `ai_connect` | 连接被拒绝 | 检查地址/端口，本地服务（Ollama）是否已启动 |
| `ai_tls` | 证书校验失败 | 核对 HTTPS 地址 |
| `ai_empty` / `ai_parse` | 空回复 / 非 JSON | 换模型或重试 |

图片测试失败**不会阻塞文本服务**：`测试全部` 并行执行，两栏各自显示结果。

## 常见错误与提示（验收点 #11 对应）

| 现象 | 原因 | 处理 |
|---|---|---|
| 「AI 服务尚未配置」 | 未填 baseUrl / 模型 | 到智能服务设置填写 |
| 「未配置 API Key」 | 未保存 Key | 输入并保存 |
| 「网络请求失败」 | 断网 / DNS / 防火墙 | 检查网络；本地 Ollama 需先启动 |
| 「HTTP 401/403」 | Key 错误或无权限 | 核对 Key 与账户额度 |
| 「HTTP 404」且含 `response_format` | 服务不支持 JSON 模式 | 已自动去掉 `response_format` 重试 |
| 「AI 返回了空内容」 | 模型空回复 / 超短输出 | 换模型或重试 |
| 「不是合法 JSON」 | 模型输出格式异常 | 已自动剥离 markdown 围栏并重试；仍失败则提示手动修正 |
| 图片生成失败 | 模型不支持 / 余额不足 | 回退：教师可上传本地图片或从图片库选择 |

**任何自动生成失败都不阻塞流程**：对应字段保持为空或「自动」状态，教师可手动填写、重新生成、或换图片来源。

## 内置能力（无需配置即可用）

- 音标：内置 en_US / en_UK IPA 词典。
- 图片：内置 29 张标准素材图（名词为主），可在「🖼️ 图片素材」查看、选择、上传本地图。
- 词典：联网时 Free Dictionary API（无需 Key）。
- 发音：Web Speech API（课堂内 TTS，无需网络账号）。
