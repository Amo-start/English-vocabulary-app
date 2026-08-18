# 极速识词 V3 完整玩法扩展 — 设计规格（P1 + P2 + 交叉增强）

> 基于 `reference/极速识词_课堂互动版_V3_游戏化课堂互动与一体机优化开发文档.docx` §18 优先级
> 前置：P0 已实现（数据模型 V3、GameEngine、班级反馈、Flash Recall、Rapid Response、触屏优化）

## 范围

本扩展覆盖文档剩余可达目标（排除需联网架构的 P3 学生手机端）：

| 优先级 | 功能 | 文档章节 |
|---|---|---|
| P1 | 🖼️ 图片侦探 Picture Hunt | §3.3 |
| P1 | 🌉 词语搭桥 Word Bridge | §3.4 |
| P1 | 复习池换玩法（学习闭环） | §10 |
| P2 | 🔊 发音挑战 | §8.2 Lv4 |
| P2 | 👥 小组协作 | §18 |
| 交叉 | 阶梯式难度（方向切换/混合） | §8.2 |
| 交叉 | 激励系统（集体目标/连胜里程碑） | §8.1 |
| 交叉 | 极简管理（粘贴表格导入、课堂内切词包/临时词条） | §12.2 / §4.2 |
| 交叉 | 内容编辑器图片/表情字段 | §4.1 |

## 核心设计原则

1. **玩法与内容解耦**：同一词包在任意玩法间切换，内容数据不变。
2. **状态机优先于 DOM**：所有新玩法沿用 `ready → hint → answer → feedback` 状态机；`transitioning` 守卫。
3. **翻牌可复用**：图片侦探/词语搭桥/发音挑战都复用餐牌，只是"正面内容"渲染不同。
4. **教师极简**：反馈仍用班级信号按钮；抢答类保留公平抽人。

## 数据模型扩展

```js
item = {
  ...现有字段,
  image: ""   // 可选：dataURL / URL / emoji。为空时由 Media 字典回退
}

appData.media = { images: {}, audio: {} }   // 已存在，MVP 暂存教师上传的 dataURL

appData.groups = [
  { id, name, memberIds: [], score: 0 }     // 小组定义（自动分组时生成）
]
```

`Store.data.settings` 新增：
- `collectiveGoal: 20` — 集体目标（每节课累计答对数）
- `difficultyLadder: false` — 阶梯难度（一轮结束后自动升档）

## 新模块

### Media —— 图片/表情解析
```js
Media.emojiFor(item) → string   // 内置字典（常用词→emoji）→ item.image → 回退字母块
Media.visual(item)  → { kind: "emoji"|"image", value }
```
内置字典覆盖演示词包 + 常见课堂词；无匹配时回退为首字母 + 底色块，保证一体机可读。

### Groups —— 小组数据
```js
Groups.split(count)          // 将启用学生均分为 count 组（蛇形分配，均衡能力/人数）
Groups.all() / get(id)
Groups.addScore(id, delta)   // 课堂内加分
Groups.resetScores()         // 新一轮清零
```

## 玩法设计

### Picture Hunt（图片侦探）— `picture-hunt`
- 正面：大号 emoji/图片 + 类型标签，提示"看图回忆单词"
- 揭晓面：单词 + 音标 + 中文 + 例句
- 反馈：标准班级信号栏
- 复用翻牌状态机，正面渲染换成图片

### Word Bridge（词语搭桥）— `word-bridge`
- 正面：单词/词组/句子（content）
- 提示面：例句作为"桥"（上下文线索，高亮目标词）；无例句时提示"联想它的用法"
- 揭晓面：中文释义
- 反馈：标准班级信号栏

### Pronunciation（发音挑战）— `pronunciation`
- 进入 hint 自动 TTS 播放内容；提供"🔊 再听一遍"按钮
- 揭晓面：单词 + 音标 + 中文 + 例句
- 反馈：标准班级信号栏

### Rapid Response 扩展：小组对抗 — `group`
- 玩法：先抽组（轮转/最少得分优先），再组内公平抽人；答对组 +1 分
- 节奏区：小组积分榜（横向条：组名 + 得分）
- 保留 S/G/R 快捷键

## 复习池换玩法（学习闭环）

- 复习池页头部：玩法选择器（闪记/图片/词语桥/发音），"开始复习"按所选玩法启动
- 每条记录显示"上次练习玩法"；"换一种方式再练"按钮 → 用不同玩法单独启动该条
- `ReviewPool.modeHistory`：轻量记录每条最近练习过的玩法（存在 entry 上）

## 交叉增强

1. **混合方向**：答案方向新增"中英混合（随机）"；每次出题随机选方向
2. **阶梯难度**：`settings.difficultyLadder` 开启后，一轮结束自动升档：
   闪记(英文→中文) → 闪记(中文→英文) → 图片侦探 → 发音 → 词语桥 → 混合
3. **集体目标**：节奏区进度条（本轮正确数 / 目标）；达 50%/100% 触发 toast+音效
4. **连胜里程碑**：3/5/10 连对触发短促音效 + 口号 toast
5. **粘贴导入**：词包详情"粘贴导入"——多行表格，Tab 或空格分隔列（内容/释义/例句），自动去重
6. **课堂内快捷**：节奏区词包下拉（切包不退出课堂）+ "临时词条"快捷添加模态

## 状态机扩展（不变）
`ready → hint → answer → feedback → ready`；`transitioning` 守卫；翻牌用 transitionend + 750ms 兜底。

## 键盘
- Space 推进（所有玩法）
- S/G/R：抢答与小组对抗
- 其余不变

## 测试策略
- 每个新模块/玩法在 `_dev/smoke.js` 增加断言
- 重点：Media 字典回退、Groups 均分、picture-hunt 翻牌时序、word-bridge 桥线索、pronunciation TTS 调用、混合方向随机、粘贴导入解析、换玩法轮换、集体目标计数
