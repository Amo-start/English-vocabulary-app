# 极速识词 V3 完整玩法扩展 — 实现计划

> 对应规格：`docs/superpowers/specs/2026-08-18-speedword-v3-full-features-design.md`
> 每阶段结束运行 `node _dev/smoke.js` 确认基线（128）不回归，再进入下阶段。

## 完成状态（2026-08-18）
✅ Phase 1–4 全部实现，Phase 5 完成：冒烟测试 **212 通过 / 0 失败**、`SpeedWord/index.html` 已同步、README / 记忆已更新。

## Phase 1 — 数据基础设施
1. `defaultAppData()`：新增 `groups: []`、`settings.collectiveGoal`、`settings.difficultyLadder`
2. `migrate()`：V2+ 分支补齐 `groups` 默认；V1 迁移也初始化 `groups`
3. `ItemBank.addItem/updateItem/mergeImport`：支持 `image` 字段
4. `Media` 模块：`emojiFor(item)` 内置字典 + `visual(item)` 回退；字典覆盖演示词包 12 项
5. `Groups` 模块：`split(n)` 蛇形均分、`all/get/addScore/resetScores`
6. `Importer.parsePasted(text)`：Tab/多空格分隔列，自动去重由 mergeImport 完成
7. 冒烟测试：Media 字典、Groups 均分、parsePasted

## Phase 2 — P1 玩法
1. `GameEngine.start` 支持全部模式；`renderGamePhase` 按模式渲染正面：
   - `picture-hunt`：正面 emoji/图片（`Media.visual`）
   - `word-bridge`：正面 content，hint 显示例句桥
   - 其余复用现有
2. `renderGameControls`：新增玩法切换控制组显示；发音挑战"🔊 再听一遍"按钮
3. 复习池换玩法：
   - `ReviewPool` entry 增加 `lastMode`
   - 复习池页：玩法选择器 + 每条"换一种方式再练"
   - `App.startWeakReview(mode)` 按玩法启动
4. 冒烟测试：picture-hunt 翻牌时序、word-bridge 桥内容、换玩法轮换

## Phase 3 — P2 玩法
1. `pronunciation`：hint 自动 `Sound.tts`；"再听一遍"；揭晓面含音标
2. `group`（小组对抗）：
   - Setup 新增"小组对抗"，组数选择（2–5）
   - `GameEngine` group 模式：先抽组再抽人，组加分；节奏区小组积分榜
   - 键盘 S/G/R 适配 group 模式
3. 冒烟测试：pronunciation TTS 调用、group 抽人/加分/积分榜

## Phase 4 — 交叉增强
1. 混合方向：Setup 方向第三选项；出题时随机方向
2. 阶梯难度：`settings.difficultyLadder` 开启后轮末自动升档（模式序列）
3. 激励：节奏区集体目标进度条；连胜 3/5/10 里程碑音效+toast
4. 粘贴导入 UI：词包详情"粘贴导入"模态
5. 课堂内快捷：节奏区词包下拉切换 + "临时词条"快捷添加
6. 内容编辑器：图片/表情字段（复用 Media 预览）
7. 冒烟测试：混合方向、集体目标计数、粘贴导入解析

## Phase 5 — 测试 / 文档 / 提交
1. 全量冒烟测试通过（128 + 新增）
2. `npm run sync:html` 同步桌面版
3. 更新 README / SpeedWord README / 记忆
4. git commit

## 风险
- GameEngine 与翻牌强耦合 → 正面渲染全部收敛到 `renderGamePhase` 单一分支
- TTS 在 jsdom 无真实合成 → 测试用 stub 验证"调用了 tts"
- 小组对抗复杂度较高 → 保持"先抽组再抽人、组积分"最小闭环
