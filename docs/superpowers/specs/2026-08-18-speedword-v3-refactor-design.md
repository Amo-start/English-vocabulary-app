# 极速识词 V3 游戏化课堂互动与一体机优化 — 重构设计

> 基于 `reference/极速识词_课堂互动版_V3_游戏化课堂互动与一体机优化开发文档.docx`

## 范围

P0 核心重构 + 基础玩法升级, 覆盖：
- 数据模型 V3（Item 替代 Word, Session, ReviewPool）
- GameEngine 状态机（取代旧 Classroom）
- 课堂 UI 三层布局 + 一体机触屏优化
- Flash Recall（旧翻牌重构）+ Rapid Response（新抢答风暴）
- 班级反馈模型（classSignal 替代个人 status）
- 复习池（ReviewPool 替代 WeakBook）
- V1→V3 自动数据迁移

## 架构变更

### 数据层
- `Store.data.version`: 1→3
- `wordPacks[]` → `packs[]`
- `pack.words[]` → `pack.items[]` (type: word | phrase | sentence)
- 移除: `word.status`, `weakWords[]`
- 新增: `sessions[]`, `reviewPool[]`, `media{}`

### 业务层
- `WordBank` → `ItemBank`: CRUD 支持多内容类型
- `Classroom` → `GameEngine`: 严格状态机 phase 驱动
- `WeakBook` → `ReviewPool`: 课堂复习池
- 新增 `Session`: 课堂活动记录

### 表现层
- 课堂界面: 三层结构（题目区 | 互动区 | 节奏区）
- 按钮最小 72px, 触屏间距 16px
- 底部反馈按钮按需显示
- 保留 Space/Enter/方向键
- CSS transition + transitionend 替代固定 setTimeout

## 状态机

```
ready → hint (显示线索) → answer (揭晓) → feedback (班级反馈) → ready
```

`transitioning` 守卫: 任何过渡期间禁止下一个操作, 使用 CSS transitionend + timeout 兜底。

## 实施顺序

1. Store V3 + migrate + ItemBank
2. GameEngine 状态机
3. UI 三层布局 + 触屏优化
4. Flash Recall 玩法重构
5. Rapid Response 玩法升级
6. ReviewPool + Session 记录
7. Smoke 测试同步