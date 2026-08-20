# V4.1 图片与保存链路重构实现计划

**Goal:** 彻底修复 AI 图片含文字、builtin 来源污染、DataCloneError、词条不存在三大根因，建立 Draft/Persistent 严格分离架构。

**Architecture:** 引入 `DraftContentItem` 临时类型；SmartCreateView 仅在生成阶段使用 draftId，save 时通过 `items:addDrafts` IPC 完成 Draft→Persistent 映射（主进程生成 UUID），图片异步补充不阻塞核心保存。图片策略：builtin 降级为 legacy_builtin，AI 图片走 SceneGenerator 先解释语义再生成图片。

**Tech Stack:** Vue 3 + TypeScript + Electron IPC + sql.js SQLite + Pinia

## Global Constraints
- IPC 只传 Plain Object / Primitive，禁止 Vue Proxy / reactive / ref / Error / Blob / File / Response
- Draft ID 不得传给任何 IPC；持久化 ID 由主进程生成
- builtin 改为 legacy_builtin，仅作为离线 fallback，不得作为智能创建默认来源
- 图片生成失败不影响词包核心保存（事务分离）
- 所有新增内容必须通过测试

---

## Task 1: 新建 DraftContentItem 类型 + DraftImageSource 枚举

**Files:**
- Create: `src/shared/draft-types.ts`
- Modify: `src/shared/types.ts`（仅加 type alias 说明）

- [ ] 在 `src/shared/draft-types.ts` 定义 DraftContentItem 接口（draftId + 无 packId/sort/createdAt/updatedAt 等持久化字段）
- [ ] 定义 `DraftImageSource = "ai" | "api" | "legacy_builtin" | "teacher" | "none"`，废弃直接 `"builtin"`
- [ ] 验证 TS 类型检查通过

---

## Task 2: ImagePromptBuilder 彻底修复——无文字 + SceneGenerator

**Files:**
- Modify: `electron/image-prompt-builder.ts`

- [ ] 在全局样式中增加绝对禁止文字的段落（No Text Constraint）
- [ ] 新增 `generateVisualScene(text, meaningZh, type)` 函数：调用文本 AI 生成场景描述（纯图片用，不含词汇单词）
- [ ] `buildImagePrompt` 改为接收 `{ sceneDescription, globalStyle }` 而非直接传入 text
- [ ] TYPE_STRATEGIES 中的 word/phrase 描述不再包含具体英文单词
- [ ] 写测试：确认 prompt 不含目标词汇字符串、含 no-text 关键词

---

## Task 3: enrich.ts 改造——去掉 builtin 自动填充，改用 AI 优先

**Files:**
- Modify: `electron/enrich.ts`

- [ ] `enrichOne()` 中：删除 `findBuiltinImage` 优先逻辑
- [ ] 改为：API 搜索 → AI 生成（不再 fallback 到 builtin）
- [ ] AI 图片生成走新的 `generateVisualScene` 获取 scene description
- [ ] `source.image` 改为 `"ai"` 或 `"api"`，不再返回 `"builtin"`
- [ ] 图片失败时 `source.image = "failed"`，不进 fallback

---

## Task 4: 新建 `items:addDrafts` IPC——Draft → Persistent 映射

**Files:**
- Modify: `electron/db.ts`（新增 `itemsAddDrafts` 函数）
- Modify: `electron/ipc.ts`（注册新通道）
- Modify: `src/shared/api.ts`（新增接口声明）
- Modify: `electron/preload.ts`（暴露新方法）

- [ ] `db.ts`: 新增 `itemsAddDrafts(packId: string, drafts: Array<{ draftId: string; ...plainFields }>): { persistentIds: string[] }`
  - 使用 `BEGIN TRANSACTION`
  - 为每个 draft 生成 crypto.randomUUID()
  - INSERT content_items（id 为主进程生成的 UUID）
  - 返回 `{ persistentIds: string[], mapping: Record<string, string> }`（draftId → persistentId）
  - COMMIT；失败 ROLLBACK
- [ ] `ipc.ts`: 注册 `items:addDrafts`，接收 Plain DTO，调用 `itemsAddDrafts`
- [ ] `api.ts`: 新增 `itemsAddDrafts(packId: string, drafts: Array<DraftSavePayload>): Promise<{ persistentIds: string[]; mapping: Record<string,string> }>`
- [ ] `preload.ts`: 暴露 `itemsAddDrafts`

---

## Task 5: SmartCreateView 重构——Draft/Persistent 分离 + 正确 regenImage

**Files:**
- Modify: `src/views/SmartCreateView.vue`
- Modify: `src/stores/packs.ts`

- [ ] `packs.ts`: 新增 `addDraftItems(packId, drafts)` 方法，调用 `itemsAddDrafts`，返回 mapping
- [ ] `SmartCreateView.vue`:
  - 生成结果仍使用 `ContentItem`（保留 id 用于草稿阶段显示）
  - **save() 函数重写**：不再调 `packs.addItems`（传完整 Vue 对象），改为调 `packs.addDraftItems(targetPackId, results.map(r => toDraftDTO(r.item)))`
  - 保存成功后用 `mapping` 更新本地 item.id（从 draftId 换成 persistentId）
  - **regenImage()**：已保存状态 → 用 `item.id`（persistentId）调 `imageRegenerate`；未保存状态 → 前端直接重新调 AI 图片（不调 IPC）
  - 图片生成状态 UI：显示 ⏳/✅/⚠ 图标
- [ ] 验证：不再传 Vue Proxy 对象给 IPC

---

## Task 6: 更新类型系统——ImageSourceType 加入 legacy_builtin

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `electron/util.ts`（如有相关逻辑）

- [ ] `ImageSourceType` 增加 `"legacy_builtin"` 值
- [ ] `newImagePlaceholder()` 在 `src/stores/helpers.ts` 和 `electron/images.ts` 中改为 `sourceType: "builtin"` 但标记 deprecated
- [ ] 新增迁移函数：扫描数据库 `image_json.sourceType === "builtin"` 的条目，更新为 `"legacy_builtin"`

---

## Task 7: 数据库迁移——将存量 builtin 图片标记为 legacy_builtin

**Files:**
- Modify: `electron/db.ts`

- [ ] 在 `migrateSchema()` 中加入 version 检查和迁移逻辑
- [ ] 执行 `UPDATE content_items SET image_json = json_set(image_json, '$.sourceType', 'legacy_builtin') WHERE json_extract(image_json, '$.sourceType') = 'builtin'`
- [ ] 写入迁移版本标记到 app_settings

---

## Task 8: 新增测试覆盖

**Files:**
- Create: `tests/draft-save-mapping.test.ts`
- Create: `tests/image-no-text.test.ts`

- [ ] `draft-save-mapping.test.ts`:
  - 测试 `itemsAddDrafts` 事务原子性
  - 测试 draftId → persistentId 映射正确性
  - 测试并发保存多词条
- [ ] `image-no-text.test.ts`:
  - 测试 prompt 不含目标词汇
  - 测试 `generateVisualScene` 输出是场景描述而非单词
  - 测试 no-text 约束出现在 prompt 中

---

## Task 9: Build + Test 验证

- [ ] `npm run typecheck` → 0 错误
- [ ] `npm test` → 全部通过（含新增测试）
- [ ] `npm run build` → 成功
- [ ] 手动验证：智能生成 → 预览 → 保存 → 重新生成图片全流程
