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

- **服务商**：OpenAI 兼容 / 其它（模型地址格式一致即可）
- **API 地址（baseUrl）**：例如 `https://api.openai.com/v1`、Ollama 的 `http://localhost:11434/v1`
- **API Key**：`●` 掩码输入；已保存时显示「已配置」占位，不再显示明文
- **文本模型**：例如 `gpt-4o-mini`、`qwen2.5:7b`（Ollama）
- **图片模型**：例如 `dall-e-3`、Ollama 的 `stable-diffusion` 等（兼容接口）

点「保存」后建议点「测试连接」，看到「连接成功」再继续。

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
- 保存时由主进程 `safeStorage`（Windows 上基于 DPAPI）加密，密文 base64 后存入 `ai_provider_settings` 表。
- 渲染进程（页面）只看到 `hasKey: true/false` 与掩码占位，**永远拿不到明文**。
- AI 请求全部由主进程发出（`electron/ai.ts`），页面无法直接调用第三方 API。
- 若系统无法加密（极少见），兜底为弱混淆并标记 `plain:`，避免崩溃；Windows 下正常走 DPAPI。

## Provider 接口

统一抽象（`electron/ai.ts`）：

```
TextProvider.complete(messages, opts?)      → string       （文本补全）
ImageProvider.generate(prompt, opts?)      → { b64 | url } （图片生成）
testConnection / testImageConnection       → { ok, message }
```

新增一家供应商只需实现对应接口，无需改动业务编排（`electron/enrich.ts`）。

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
