# examples / 示例

安装版自带本目录（electron-builder `files` 已包含 `examples/**`）。所有示例均可直接使用。

## 示例词包（可直接导入）

| 文件 | 说明 |
|---|---|
| `示例词包-初一U3.swpack` | 可直接导入的 `.swpack` 词包（6 个词条，含 2 张内嵌图片素材、复习池与课堂 Session 元数据） |
| `build-example-pack.mjs` | 生成该 `.swpack` 的脚本（`node examples/build-example-pack.mjs`） |

**导入方式**：软件「💾 备份恢复」→ 导入词包 → 选择该文件。
导入后可在「课堂游戏」里选择「初一 U3 课堂词包（示例）」直接开始课堂。

该示例演示了 `.swpack` 的完整能力：

- 内容类型：`word`（apple/responsibility）、`phrasal_verb`（look after / take care of）、`sentence`（This is my book.）
- 素材：`images/` 内嵌 SVG 图片，导入时自动重映射到本地 `media/user/`
- 字段状态：`meaningZh: "edited"`（教师改过）、`example: "locked"`（教师锁定）—— 智能补全不会覆盖
- 元数据：`metadata/classroom.json` 携带复习池与最近课堂 Session 概览

## 可直接粘贴的内容

| 文件 | 说明 |
|---|---|
| `sample-words.txt` | 可粘贴到「✨ 智能创建」的内容清单（含注释与多种格式演示） |

## 课堂数据结构示例

| 文件 | 说明 |
|---|---|
| `sample-classroom.json` | 课堂 Session / 班级反馈 / 复习池的数据结构示例（V4 为 Session 级反馈，重点复习自动入复习池） |

实际课堂数据保存在本地 SQLite（`%APPDATA%/极速识词/speedword.db`），不在此目录。
