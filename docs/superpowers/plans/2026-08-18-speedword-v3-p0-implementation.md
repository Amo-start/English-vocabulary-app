# 极速识词 V3 P0 核心重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 V3 开发文档对现有的 speedword-classroom.html 单页面应用进行 P0 核心重构，实现数据模型升级（Item 替代 Word）、GameEngine 状态机、班级反馈模型、课堂 UI 三层布局、一体机触屏优化、复习池机制，并保留 Flash Recall（翻牌重构）+ 新增 Rapid Response 玩法。

**Architecture:** 在单 HTML 文件内完成所有变更，保持"双击即用"传统。采用状态机驱动 UI、CSS transition 保障动画可靠、Store V3 数据模型自动从 V1 迁移。

**Tech Stack:** Vanilla JavaScript (ES6), CSS3 with clamp/min/max, Web Audio API, SpeechSynthesis API, LocalStorage

## Global Constraints

- 所有业务逻辑在 `speedword-classroom.html` 一个文件内
- 同步更新 `_dev/smoke.js` 测试
- V1→V3 数据自动迁移（不丢弃用户数据）
- 按钮高度 ≥72px（一体机触屏优化），关键按钮间距 ≥16px
- 所有交互必须支持触屏 + 键盘（Space/Enter/方向键/Esc）
- 避免 hover-only UI
- 状态机必须优先于 DOM 事件
- transitionend + setTimeout 兜底保障动画同步
- XSS 防御（textContent 写入，避免 innerHTML）
- 课堂反馈使用 classSignal（mastered|partial|retry|unrated），不写回 item 永久状态

---

### Task 1: Store V3 数据模型 + V1→V3 自动迁移

**Files:**
- Modify: `speedword-classroom.html` — Store + migrate 部分
- Test: `_dev/smoke.js` — 新增 V3 数据模型测试

**Interfaces:**
- Consumes: 旧 `Store` 对象中的 `data.version`, `data.wordPacks`, `data.weakWords`, `data.statistics`
- Produces: `Store.data` 新结构:
  ```javascript
  Store.data = {
    version: 3,
    settings: { theme, soundEnabled, autoNext },
    packs: [{
      id, name, description,
      items: [{ id, type: 'word'|'phrase'|'sentence', content, phonetic, meaning, example, tags, difficulty, createdAt, updatedAt }],
      createdAt, updatedAt
    }],
    students: [{ id, name, enabled, callCount, correctCount, weakCount }],
    sessions: [{ id, className, packId, gameMode, startedAt, endedAt, itemResults: [...] }],
    reviewPool: [{ itemId, packId, reasons: ['teacher-marked'|'multiple-wrong'|'manual'|'long-unseen'], count, lastSeenAt, addedAt }],
    media: { images: {}, audio: {} },
    statistics: { totalReviewed: 0, masteredCount: 0, weakCount: 0 }
  }
  ```

- [ ] **Step 1: Write failing smoke tests for V3 Store + migrate**

```javascript
// In _dev/smoke.js — add to test section
// V3 数据模型
ok(SW.Store.data.version === 3, "Store version = 3");
ok(SW.Store.data.packs !== undefined, "packs 数组存在（取代 wordPacks）");
ok(SW.Store.data.sessions !== undefined, "sessions 数组存在");
ok(SW.Store.data.reviewPool !== undefined, "reviewPool 数组存在");
ok(SW.Store.data.wordPacks === undefined, "wordPacks 已不复存在");

// V1→V3 迁移：旧数据播种后用新 Store.load()
// 清空 localStorage，保存 V1 格式数据，再调用 Store.load()
window.localStorage.removeItem("speedword_classroom_data");
window.localStorage.setItem("speedword_classroom_data", JSON.stringify({
  version: 1,
  settings: { theme: "dark", soundEnabled: true, autoNext: false },
  wordPacks: [{
    id: "v1-pack", name: "V1 Demo", description: "",
    words: [{ id: "v1-word", word: "apple", phonetic: "/a/", meaning: "苹果", example: "I eat an apple.", status: "mastered", createdAt: 0, updatedAt: 0 }]
  }],
  students: [],
  weakWords: [],
  statistics: { totalReviewed: 0, masteredCount: 0, weakCount: 0 }
}));
const loaded = SW.Store.load();
ok(loaded === true, "V1 数据可加载");
ok(SW.Store.data.version === 3, "加载后版本变为 3");
ok(SW.Store.data.packs.length === 1, "迁移后 packs 有 1 个");
ok(SW.Store.data.packs[0].items.length === 1, "迁移后 items 有 1 条");
ok(SW.Store.data.packs[0].items[0].type === "word", "迁移后 item.type = word");
ok(SW.Store.data.packs[0].items[0].content === "apple", "迁移后 item.content = apple");
ok(SW.Store.data.packs[0].items[0].status === undefined, "迁移后 item.status 不存在（不再永久标记）");
ok(SW.Store.data.sessions.length === 0, "迁移后 sessions 为空数组");
ok(SW.Store.data.reviewPool.length === 0, "迁移后 reviewPool 为空数组");
```

Run: `node _dev/smoke.js` — 预期部分失败（旧 Store 仍用 wordPacks）

- [ ] **Step 2: 重构 Store.data 默认结构和数据模型**

在 `speedword-classroom.html` 中替换 `defaultAppData()`:

```javascript
function defaultAppData(){
  return {
    version: 3,
    settings: {
      theme: "dark",
      soundEnabled: true,
      autoNext: false
    },
    packs: [],
    students: [],
    sessions: [],
    reviewPool: [],
    media: { images: {}, audio: {} },
    statistics: {
      totalReviewed: 0,
      masteredCount: 0,
      weakCount: 0
    }
  };
}
```

- [ ] **Step 3: 替换 STORAGE_KEY 和 migrate 函数**

```javascript
const STORAGE_KEY = "speedword_classroom_data";

function migrate(raw){
  if (!raw || typeof raw !== "object") return defaultAppData();
  const base = defaultAppData();

  // V1 → V3 迁移
  if (raw.version === 1) {
    // 迁移 wordPacks → packs, words → items
    if (Array.isArray(raw.wordPacks)) {
      base.packs = raw.wordPacks.map(p => ({
        id: p.id || Utils.uid("pack"),
        name: p.name || "",
        description: p.description || "",
        items: (p.words || []).map(w => ({
          id: w.id || Utils.uid("item"),
          type: "word",
          content: w.word || "",
          phonetic: w.phonetic || "",
          meaning: w.meaning || "",
          example: w.example || "",
          tags: [],
          difficulty: 2,
          createdAt: w.createdAt || Utils.now(),
          updatedAt: w.updatedAt || Utils.now()
        })),
        createdAt: p.createdAt || Utils.now(),
        updatedAt: p.updatedAt || Utils.now()
      }));
    }
    // 迁移学生
    if (Array.isArray(raw.students)) base.students = raw.students;
    // 不再迁移 weakWords（V3 使用 reviewPool）
    // 迁移设置
    if (raw.settings) base.settings = Object.assign(base.settings, raw.settings);
    // 迁移统计
    if (raw.statistics) base.statistics = Object.assign(base.statistics, raw.statistics);
    base.version = 3;

    // 清理旧字段
    delete base.wordPacks;
    delete base.weakWords;
    return base;
  }

  // V3+ 直接合并
  const data = Object.assign(base, raw);
  if (!Array.isArray(data.packs)) data.packs = [];
  if (!Array.isArray(data.students)) data.students = [];
  if (!Array.isArray(data.sessions)) data.sessions = [];
  if (!Array.isArray(data.reviewPool)) data.reviewPool = [];
  if (!data.media) data.media = { images: {}, audio: {} };
  if (!data.settings) data.settings = base.settings;
  if (!data.statistics) data.statistics = base.statistics;
  data.version = 3;
  delete data.wordPacks;
  delete data.weakWords;
  return data;
}
```

- [ ] **Step 4: 更新 Store 对象方法（load/save/migrate/export/import）**

```javascript
const Store = {
  data: defaultAppData(),

  load(){
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { saved = null; }
    if (!saved) return false;
    try {
      const parsed = JSON.parse(saved);
      Store.data = migrate(parsed);
      return true;
    } catch (e) {
      console.error("本地数据解析失败，使用默认数据", e);
      return false;
    }
  },

  save(){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Store.data));
    } catch (e) {
      console.error("保存失败", e);
      UI.toast("保存失败，浏览器存储空间可能已满", "err");
    }
  },

  exportJSON(){
    return JSON.stringify(Store.data, null, 2);
  },

  importBackup(text){
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) {
      return { ok: false, error: "导入失败：JSON 文件格式不正确。\n请检查文件后重新导入。" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "导入失败：JSON 根节点不是预期的备份对象。\n请选择由本应用导出的备份文件。" };
    }
    const migrated = migrate(parsed);
    if (!Array.isArray(migrated.packs)) {
      return { ok: false, error: "导入失败：文件中缺少词包数据。" };
    }
    Store.data = migrated;
    Store.save();
    return { ok: true };
  },

  clearAll(){
    Store.data = defaultAppData();
    Store.save();
  }
};
```

- [ ] **Step 5: 更新演示数据**

```javascript
const DEMO_PACK = {
  name: "Unit 1 · Everyday English",
  description: "第一单元 · 日常英语核心词汇",
  items: [
    { type: "word", content: "apple",      phonetic: "/ˈæpəl/",        meaning: "苹果",   example: "I eat an apple every day." },
    { type: "word", content: "book",       phonetic: "/bʊk/",          meaning: "书",     example: "This is my English book." },
    { type: "word", content: "teacher",    phonetic: "/ˈtiːtʃər/",     meaning: "老师",   example: "Our teacher is very kind." },
    { type: "word", content: "student",    phonetic: "/ˈstjuːdnt/",    meaning: "学生",   example: "She is a good student." },
    { type: "word", content: "classroom",  phonetic: "/ˈklɑːsruːm/",   meaning: "教室",   example: "The classroom is clean." },
    { type: "word", content: "friend",     phonetic: "/frend/",        meaning: "朋友",   example: "Tom is my best friend." },
    { type: "word", content: "happy",      phonetic: "/ˈhæpi/",        meaning: "快乐的", example: "I am very happy today." },
    { type: "word", content: "beautiful",  phonetic: "/ˈbjuːtɪfl/",    meaning: "美丽的", example: "What a beautiful flower!" },
    { type: "word", content: "school",     phonetic: "/skuːl/",        meaning: "学校",   example: "I go to school by bus." },
    { type: "word", content: "morning",    phonetic: "/ˈmɔːrnɪŋ/",     meaning: "早晨",   example: "Good morning, everyone!" },
    // 新增词组/句子演示
    { type: "phrase", content: "take care", phonetic: "/teɪk keər/",   meaning: "保重；小心", example: "Take care on your way home." },
    { type: "sentence", content: "How are you?", phonetic: "/haʊ ɑːr juː/", meaning: "你好吗？", example: "" }
  ]
};
```

- [ ] **Step 6: Run smoke tests to verify migration works**

Run: `node _dev/smoke.js` — 预期迁移相关的测试通过，但其他引用旧 Store 结构的测试失败（因为 WordBank 等模块还未更新）

- [ ] **Step 7: Commit**

```bash
git add speedword-classroom.html _dev/smoke.js
git commit -m "feat(v3): Store V3 data model with V1→V3 auto migration"
```

---

### Task 2: ItemBank（取代 WordBank）

**Files:**
- Modify: `speedword-classroom.html` — 将 WordBank 重构为 ItemBank
- Test: `_dev/smoke.js` — 更新 ItemBank 测试

**Interfaces:**
- Consumes: `Store.data.packs` (V3 结构)
- Produces:
  ```javascript
  ItemBank = {
    all() → packs[],
    get(packId) → pack | undefined,
    create(name, desc) → pack,
    update(packId, name, desc) → pack,
    remove(packId): void,
    addItem(packId, fields: {type, content, phonetic, meaning, example, tags}) → item | null,
    updateItem(packId, itemId, fields) → item,
    removeItem(packId, itemId): void,
    mergeImport(packId, items[]) → number (added count)
  }
  ```

- [ ] **Step 1: Write failing smoke tests for ItemBank**

```javascript
// 替换旧 WordBank 测试
const itemPack = SW.ItemBank.create("Item Test", "V3 item pack");
ok(!!itemPack, "ItemBank.create 成功");
ok(itemPack.items.length === 0, "新建词包 items 为空");
ok(itemPack.id.length > 0, "词包有 id");

const item = SW.ItemBank.addItem(itemPack.id, {
  type: "phrase", content: "take care", phonetic: "/teɪk keər/",
  meaning: "保重；小心", example: "Take care!"
});
ok(!!item, "addItem 成功");
ok(item.type === "phrase", "addItem 保留 type=phrase");
ok(item.content === "take care", "addItem 保留 content");
ok(item.status === undefined, "新 item 无 status 字段");

const updated = SW.ItemBank.updateItem(itemPack.id, item.id, { meaning: "保重；一路平安" });
ok(updated.meaning === "保重；一路平安", "updateItem 成功");

SW.ItemBank.removeItem(itemPack.id, item.id);
ok(SW.ItemBank.get(itemPack.id).items.length === 0, "removeItem 后 items 为空");

const added = SW.ItemBank.mergeImport(itemPack.id, [
  { content: "apple", meaning: "苹果", type: "word" },
  { content: "apple", meaning: "苹果", type: "word" }, // 重复
  { content: "book", meaning: "书", type: "word" }
]);
ok(added === 2, "mergeImport 合并 2 条新（1 条重复跳过）");
```

- [ ] **Step 2: 实现 ItemBank**

```javascript
const ItemBank = {
  all(){ return Store.data.packs; },
  get(packId){ return Store.data.packs.find(p => p.id === packId); },
  create(name, desc){
    if (!name || !name.trim()) return null;
    const now = Utils.now();
    const pack = {
      id: Utils.uid("pack"),
      name: name.trim(),
      description: (desc || "").trim(),
      items: [],
      createdAt: now,
      updatedAt: now
    };
    Store.data.packs.push(pack);
    Store.save();
    return pack;
  },
  update(packId, name, desc){
    const p = ItemBank.get(packId);
    if (!p) return null;
    p.name = (name || "").trim();
    p.description = (desc || "").trim();
    p.updatedAt = Utils.now();
    Store.save();
    return p;
  },
  remove(packId){
    Store.data.packs = Store.data.packs.filter(p => p.id !== packId);
    Store.data.reviewPool = Store.data.reviewPool.filter(r => r.packId !== packId);
    Store.save();
  },
  addItem(packId, fields){
    const p = ItemBank.get(packId);
    if (!p || !fields.content || !fields.content.trim() || !fields.meaning || !fields.meaning.trim()) return null;
    const now = Utils.now();
    const item = {
      id: Utils.uid("item"),
      type: fields.type || "word",
      content: fields.content.trim(),
      phonetic: (fields.phonetic || "").trim(),
      meaning: fields.meaning.trim(),
      example: (fields.example || "").trim(),
      tags: fields.tags || [],
      difficulty: fields.difficulty || 2,
      createdAt: now,
      updatedAt: now
    };
    p.items.push(item);
    p.updatedAt = now;
    Store.save();
    return item;
  },
  updateItem(packId, itemId, fields){
    const p = ItemBank.get(packId);
    if (!p) return null;
    const item = p.items.find(x => x.id === itemId);
    if (!item) return null;
    if (fields.type != null) item.type = fields.type;
    if (fields.content != null) item.content = fields.content.trim();
    if (fields.phonetic != null) item.phonetic = fields.phonetic.trim();
    if (fields.meaning != null) item.meaning = fields.meaning.trim();
    if (fields.example != null) item.example = fields.example.trim();
    if (fields.tags != null) item.tags = fields.tags;
    if (fields.difficulty != null) item.difficulty = fields.difficulty;
    item.updatedAt = Utils.now();
    p.updatedAt = Utils.now();
    Store.save();
    return item;
  },
  removeItem(packId, itemId){
    const p = ItemBank.get(packId);
    if (!p) return;
    p.items = p.items.filter(x => x.id !== itemId);
    Store.data.reviewPool = Store.data.reviewPool.filter(r => !(r.packId === packId && r.itemId === itemId));
    p.updatedAt = Utils.now();
    Store.save();
  },
  mergeImport(packId, items){
    const p = ItemBank.get(packId);
    if (!p) return 0;
    const existing = new Set(p.items.map(i => i.content.trim().toLowerCase()));
    const now = Utils.now();
    let added = 0;
    for (const it of items) {
      const key = (it.content || "").trim().toLowerCase();
      if (!key || existing.has(key)) continue;
      existing.add(key);
      p.items.push({
        id: Utils.uid("item"),
        type: it.type || "word",
        content: it.content.trim(),
        phonetic: it.phonetic || "",
        meaning: it.meaning || "",
        example: it.example || "",
        tags: [],
        difficulty: 2,
        createdAt: now,
        updatedAt: now
      });
      added++;
    }
    if (added) p.updatedAt = now;
    Store.save();
    return added;
  }
};
```

- [ ] **Step 3: Old `WordBank` reference → 全局替换为 `ItemBank` + 更新所有调用处**

全局搜索并替换：
- `WordBank` → `ItemBank`
- `wordPack` → `pack`
- `p.words` → `p.items`
- `w.word` → `w.content` (在渲染/显示上下文中)
- `w.status` 相关逻辑 → 移除（V3 不再使用 item.status）

注意保持语义不变的字段：`id`, `phonetic`, `meaning`, `example` 不变。

- [ ] **Step 4: Run smoke tests**

Run: `node _dev/smoke.js` — 预期 ItemBank 相关测试通过

- [ ] **Step 5: Commit**

```bash
git add speedword-classroom.html _dev/smoke.js
git commit -m "feat(v3): ItemBank replaces WordBank with multi-type item support"
```

---

### Task 3: ReviewPool（取代 WeakBook）+ Session

**Files:**
- Modify: `speedword-classroom.html` — 添加 ReviewPool 和 Session
- Test: `_dev/smoke.js` — 测试 ReviewPool 和 Session

**Interfaces:**
```javascript
ReviewPool = {
  all() → reviewPool[],
  add(itemId, packId, reason: 'teacher-marked'|'multiple-wrong'|'manual'|'long-unseen'): void,
  remove(itemId, packId): void,
  getByPack(packId) → reviewPool[],
  getByReason(reason) → reviewPool[],
  clear(): void,
  getItems(packId) → items[] (从 reviewPool 获取完整 item 对象)
}

Session = {
  create(className, packId, gameMode) → sessionId,
  recordResult(sessionId, itemId, classSignal, responseCount, correctCount): void,
  end(sessionId): void,
  get(id) → session | undefined,
  getAll() → sessions[],
  getByPack(packId) → sessions[]
}
```

- [ ] **Step 1: Write failing tests for ReviewPool + Session**

```javascript
// ReviewPool
const poolPack = SW.ItemBank.create("Pool Test", "");
const poolItem = SW.ItemBank.addItem(poolPack.id, { content: "test", meaning: "测试", type: "word" });
ok(SW.ReviewPool.all().length === 0, "ReviewPool 初始为空");
SW.ReviewPool.add(poolItem.id, poolPack.id, "teacher-marked");
ok(SW.ReviewPool.all().length === 1, "add 后长度 = 1");
ok(SW.ReviewPool.all()[0].reasons.includes("teacher-marked"), "原因记录正确");
SW.ReviewPool.add(poolItem.id, poolPack.id, "multiple-wrong");
ok(SW.ReviewPool.all()[0].reasons.length === 2, "同一 item 的多个原因累加");
SW.ReviewPool.remove(poolItem.id, poolPack.id);
ok(SW.ReviewPool.all().length === 0, "remove 后清空");

// Session
const sid = SW.Session.create("Class 1", poolPack.id, "flash-recall");
ok(!!sid, "Session.create 返回 id");
let session = SW.Session.get(sid);
ok(!!session, "Session.get 找到");
ok(session.className === "Class 1", "className 正确");
ok(session.itemResults.length === 0, "itemResults 初始为空");
SW.Session.recordResult(sid, poolItem.id, "mastered", 10, 8);
session = SW.Session.get(sid);
ok(session.itemResults.length === 1, "recordResult 添加一条");
ok(session.itemResults[0].classSignal === "mastered", "classSignal = mastered");
SW.Session.end(sid);
session = SW.Session.get(sid);
ok(!!session.endedAt, "end 后 endedAt 有值");
```

- [ ] **Step 2: 实现 ReviewPool**

```javascript
const ReviewPool = {
  all(){ return Store.data.reviewPool; },
  add(itemId, packId, reason){
    let entry = Store.data.reviewPool.find(r => r.itemId === itemId && r.packId === packId);
    if (entry) {
      if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
      entry.count++;
      entry.lastSeenAt = Utils.now();
    } else {
      Store.data.reviewPool.push({
        itemId, packId,
        reasons: [reason],
        count: 1,
        lastSeenAt: Utils.now(),
        addedAt: Utils.now()
      });
    }
    Store.save();
  },
  remove(itemId, packId){
    Store.data.reviewPool = Store.data.reviewPool.filter(r => !(r.itemId === itemId && r.packId === packId));
    Store.save();
  },
  getByPack(packId){
    return Store.data.reviewPool.filter(r => r.packId === packId);
  },
  getItems(packId){
    const p = ItemBank.get(packId);
    if (!p) return [];
    const inPool = Store.data.reviewPool.filter(r => r.packId === packId);
    return inPool
      .map(r => ({ ...r, item: p.items.find(i => i.id === r.itemId) }))
      .filter(x => x.item);
  },
  clear(){
    Store.data.reviewPool = [];
    Store.save();
  }
};
```

- [ ] **Step 3: 实现 Session**

```javascript
const Session = {
  create(className, packId, gameMode){
    const session = {
      id: Utils.uid("session"),
      className: className || "",
      packId,
      gameMode: gameMode || "flash-recall",
      startedAt: Utils.now(),
      endedAt: null,
      itemResults: []
    };
    Store.data.sessions.push(session);
    Store.save();
    return session.id;
  },
  recordResult(sessionId, itemId, classSignal, responseCount, correctCount){
    const s = Store.data.sessions.find(x => x.id === sessionId);
    if (!s) return;
    const existing = s.itemResults.find(r => r.itemId === itemId);
    if (existing) {
      existing.classSignal = classSignal;
      existing.responseCount = (responseCount || 0);
      existing.correctCount = (correctCount || 0);
    } else {
      s.itemResults.push({
        itemId,
        classSignal: classSignal || "unrated",
        responseCount: responseCount || 0,
        correctCount: correctCount || 0,
        notes: ""
      });
    }
    Store.save();
  },
  end(sessionId){
    const s = Store.data.sessions.find(x => x.id === sessionId);
    if (!s) return;
    s.endedAt = Utils.now();
    Store.save();
  },
  get(id){ return Store.data.sessions.find(x => x.id === id); },
  getAll(){ return Store.data.sessions; },
  getByPack(packId){ return Store.data.sessions.filter(s => s.packId === packId); }
};
```

- [ ] **Step 4: Run smoke tests**

Run: `node _dev/smoke.js` — 预期 ReviewPool + Session 测试通过

- [ ] **Step 5: Commit**

```bash
git add speedword-classroom.html _dev/smoke.js
git commit -m "feat(v3): ReviewPool and Session modules"
```

---

### Task 4: GameEngine + 新 Classroom 三层 UI

**Files:**
- Modify: `speedword-classroom.html` — 重构 Classroom 为 GameEngine，重写课堂 UI
- Test: `_dev/smoke.js` — 更新课堂测试

**Interfaces:**
```javascript
const GameEngine = {
  state: {
    active: false,
    phase: 'ready',          // ready | hint | answer | feedback
    mode: 'flash-recall',    // flash-recall | rapid-response
    direction: 'word-to-meaning' | 'meaning-to-word',
    shuffled: true,
    isReview: false,
    pack: null,
    queue: [{ pack, item }],
    currentIndex: 0,
    currentItem: null,
    hintVisible: false,
    answerVisible: false,
    transitioning: false,
    timer: 0,
    streak: 0,
    classSignal: 'unrated',
    sessionId: null,
    lastStudentId: null,
    selectedStudentId: null
  },
  start(opts): void,
  exit(): void,
  advance(): void,          // 从 ready→hint / hint→answer / answer→feedback / feedback→next
  flipHint(): void,          // 显示线索
  revealAnswer(): void,      // 揭晓答案
  setClassSignal(signal): void,  // mastered | partial | retry
  next(): void,
  prev(): void,
  pickStudent(): void,
  judge(type): void
}
```

- [ ] **Step 1: 重构课堂 HTML 为三层结构**

替换 `#view-classroom` 的内容：

```html
<section class="view" id="view-classroom">
  <div class="classroom">
    <!-- === 节奏区 (top) === -->
    <header class="classroom-top" id="cr-top">
      <div class="cr-meta">
        <span class="cr-mode" id="cr-mode">闪记挑战</span>
        <span id="cr-packname"></span>
        <span class="dim" id="cr-progress"></span>
      </div>
      <div class="cr-status">
        <span class="cr-streak" id="cr-streak"></span>
        <span class="cr-timer" id="cr-timer"></span>
      </div>
      <div class="cr-actions">
        <button class="btn btn-ghost btn-sm" data-action="toggle-fullscreen">⛶ 全屏</button>
        <button class="btn btn-ghost btn-sm" data-action="exit-class">退出 Esc</button>
      </div>
    </header>

    <!-- === 题目区 (stage) === -->
    <div class="stage" id="stage">
      <div class="flip-card" id="flip-card">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <div class="card-label" id="card-type-label"></div>
            <div class="card-content" id="card-front-content"></div>
            <div class="card-phonetic" id="card-front-phonetic"></div>
            <div class="card-hint" id="card-hint-text">点击卡片或按 空格 查看提示</div>
          </div>
          <div class="flip-card-back">
            <div class="card-content" id="card-back-content"></div>
            <div class="card-meaning" id="card-back-meaning"></div>
            <div class="card-example" id="card-back-example"></div>
          </div>
        </div>
      </div>
      <!-- 抢答抽人元素 -->
      <div class="quiz-wheel hidden" id="quiz-wheel">?</div>
      <div class="quiz-pick hidden" id="quiz-pick"></div>
    </div>

    <!-- === 互动区 (controls) === -->
    <div class="cr-controls" id="cr-controls">
      <!-- 闪记挑战控制 -->
      <div id="cr-flash-controls" class="cr-controls-group">
        <button class="btn btn-ghost" data-action="prev-word">← 上一题</button>
        <button class="btn btn-ghost" data-action="advance" id="btn-advance">揭晓答案</button>
        <button class="btn btn-primary" data-action="next-word">下一题 →</button>
      </div>
      <!-- 抢答风暴控制 -->
      <div id="cr-rapid-controls" class="cr-controls-group hidden">
        <button class="btn btn-ghost" data-action="pick-student">🎯 随机抽人</button>
        <button class="btn btn-ghost" data-action="advance">揭晓</button>
        <button class="btn btn-success" data-action="judge-correct">答对 ✓</button>
        <button class="btn btn-danger" data-action="judge-weak">存疑 ✕</button>
        <button class="btn btn-primary" data-action="next-word">下一题 →</button>
      </div>
      <!-- 班级反馈按钮（按需显示） -->
      <div id="cr-feedback-bar" class="cr-feedback-bar hidden">
        <span class="cr-feedback-label">全班反馈：</span>
        <button class="btn btn-success" data-action="signal-mastered">👍 全班掌握</button>
        <button class="btn btn-ghost" data-action="signal-partial">🤔 部分掌握</button>
        <button class="btn btn-danger" data-action="signal-retry">🔄 需要再练</button>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: 实现 GameEngine 状态机**

```javascript
const GameEngine = {
  state: {
    active: false,
    phase: 'ready',
    mode: 'flash-recall',
    direction: 'word-to-meaning',
    shuffled: true,
    isReview: false,
    pack: null,
    queue: [],
    currentIndex: 0,
    currentItem: null,
    hintVisible: false,
    answerVisible: false,
    transitioning: false,
    timer: 0,
    streak: 0,
    classSignal: 'unrated',
    sessionId: null,
    lastStudentId: null,
    selectedStudentId: null
  },

  start(opts){
    const st = GameEngine.state;
    st.active = true;
    st.phase = 'ready';
    st.mode = opts.mode || 'flash-recall';
    st.direction = opts.direction || 'word-to-meaning';
    st.shuffled = opts.shuffled !== false;
    st.isReview = !!opts.isReview;
    st.pack = opts.pack || null;
    st.hintVisible = false;
    st.answerVisible = false;
    st.transitioning = false;
    st.streak = 0;
    st.classSignal = 'unrated';
    st.lastStudentId = null;
    st.selectedStudentId = null;
    st.timer = 0;

    let items;
    if (opts.items) items = opts.items;
    else if (opts.pack) items = opts.pack.items.map(i => ({ pack: opts.pack, item: i }));
    else items = [];

    st.queue = st.shuffled ? Utils.shuffle(items) : items;
    st.currentIndex = 0;
    st.currentItem = st.queue[0] || null;

    // 创建 Session
    st.sessionId = Session.create(
      opts.className || "",
      opts.pack ? opts.pack.id : "",
      st.mode
    );

    UI.showView("classroom");
  },

  exit(){
    const st = GameEngine.state;
    if (st.sessionId) Session.end(st.sessionId);
    st.active = false;
    UI.showView("home");
  },

  cur(){ return GameEngine.state.currentItem; },

  // 推进阶段：ready → hint / hint → answer / answer → feedback
  advance(){
    const st = GameEngine.state;
    if (st.transitioning || !st.active) return;

    if (st.phase === 'ready') {
      // 显示提示（正面）
      st.phase = 'hint';
      st.hintVisible = true;
      UI.renderGamePhase();
    } else if (st.phase === 'hint') {
      // 揭晓答案（翻牌）
      st.phase = 'answer';
      st.answerVisible = true;
      st.transitioning = true;
      const card = document.getElementById("flip-card");
      card.classList.add("is-flipped");
      GameEngine.playAudio();
      // transitionend + timeout 兜底
      const onEnd = () => {
        card.removeEventListener("transitionend", onEnd);
        st.transitioning = false;
        UI.renderGamePhase();
      };
      card.addEventListener("transitionend", onEnd);
      setTimeout(() => { if (st.transitioning) { st.transitioning = false; UI.renderGamePhase(); } }, 700);
    } else if (st.phase === 'answer') {
      // 进入反馈阶段
      st.phase = 'feedback';
      UI.renderGamePhase();
    }
  },

  revealHint(){
    if (GameEngine.state.phase === 'ready') GameEngine.advance();
  },

  setClassSignal(signal){
    const st = GameEngine.state;
    if (st.phase !== 'answer' && st.phase !== 'feedback') return;
    st.classSignal = signal;
    // 记录到 Session
    if (st.sessionId && st.currentItem) {
      Session.recordResult(st.sessionId, st.currentItem.item.id, signal, 1, signal === 'mastered' ? 1 : 0);
    }
    // 更新 ReviewPool
    if (st.currentItem && (signal === 'retry' || signal === 'partial')) {
      ReviewPool.add(st.currentItem.item.id, st.currentItem.pack.id, 'teacher-marked');
    } else if (st.currentItem && signal === 'mastered') {
      ReviewPool.remove(st.currentItem.item.id, st.currentItem.pack.id);
    }
    if (signal === 'mastered') {
      st.streak++;
      Store.data.statistics.masteredCount++;
    } else {
      st.streak = 0;
      Store.data.statistics.weakCount++;
    }
    Store.data.statistics.totalReviewed++;
    Store.save();
    UI.renderGamePhase();
  },

  next(){
    const st = GameEngine.state;
    if (st.transitioning) return;
    if (st.currentIndex < st.queue.length - 1) {
      // 恢复 ready 阶段
      st.currentIndex++;
      st.phase = 'ready';
      st.hintVisible = false;
      st.answerVisible = false;
      st.classSignal = 'unrated';
      const card = document.getElementById("flip-card");
      card.classList.remove("is-flipped");
      st.currentItem = st.queue[st.currentIndex];
      UI.renderGamePhase();
    } else {
      // 结束
      if (st.sessionId) Session.end(st.sessionId);
      UI.toast(st.isReview ? "复习完成 🎉" : "本轮完成 🎉", "ok");
    }
  },

  prev(){
    const st = GameEngine.state;
    if (st.transitioning) return;
    if (st.currentIndex > 0) {
      st.currentIndex--;
      st.phase = 'ready';
      st.hintVisible = false;
      st.answerVisible = false;
      st.classSignal = 'unrated';
      const card = document.getElementById("flip-card");
      card.classList.remove("is-flipped");
      st.currentItem = st.queue[st.currentIndex];
      UI.renderGamePhase();
    }
  },

  // 抢答模式
  pickStudent(){
    const st = GameEngine.state;
    if (st.transitioning || st.selectedStudentId || UI.wheelRunning) return;
    const chosen = Students.pick(st.lastStudentId);
    if (!chosen) { UI.toast("没有可用学生，请先在「学生名单」中添加", "err"); return; }
    st.lastStudentId = chosen.id;
    st.selectedStudentId = chosen.id;
    Sound.pick();
    UI.renderQuizWheel(chosen);
  },

  judge(type){
    const st = GameEngine.state;
    if (!st.selectedStudentId) { UI.toast("请先「随机抽人」", "err"); return; }
    const ok = type === "correct";
    Students.record(st.selectedStudentId, ok ? "correct" : "weak");
    st.selectedStudentId = null;
    UI.renderQuizPickResult(null);
    UI.toast(ok ? "答对 ✓" : "存疑 ✕", ok ? "ok" : "err");
    UI.renderGamePhase();
  },

  playAudio(){
    const item = GameEngine.cur();
    if (!item || !item.item) return;
    if ('speechSynthesis' in window && Store.data.settings.soundEnabled) {
      const utterance = new SpeechSynthesisUtterance(item.item.content);
      utterance.lang = 'en-US';
      utterance.rate = 0.85;
      speechSynthesis.speak(utterance);
    }
  }
};
```

- [ ] **Step 3: 实现新 UI.renderGamePhase() 方法**

```javascript
// 在 UI 对象中替换/添加：
renderGamePhase(){
  const st = GameEngine.state;
  const item = st.currentItem;
  if (!item || !item.item) return;

  const w = item.item;

  // 更新顶部节奏区
  document.getElementById("cr-mode").textContent = st.mode === "flash-recall" ? "⚡ 闪记挑战" : "🏆 抢答风暴";
  document.getElementById("cr-packname").textContent = st.isReview ? "复习池" : (st.pack ? st.pack.name : "");
  document.getElementById("cr-progress").textContent = (st.currentIndex + 1) + " / " + st.queue.length;

  // 更新连胜/计时
  const streakEl = document.getElementById("cr-streak");
  if (st.streak >= 2) {
    streakEl.textContent = "🔥 全班连对 " + st.streak + " 题";
    streakEl.style.display = "inline";
  } else {
    streakEl.style.display = "none";
  }

  // 更新类型标签
  const labelMap = { word: "单词", phrase: "词组", sentence: "句子" };
  document.getElementById("card-type-label").textContent = labelMap[w.type] || "单词";

  // 题目区
  if (st.phase === 'ready' || st.phase === 'hint') {
    const frontContent = st.direction === "word-to-meaning" ? w.content : w.meaning;
    document.getElementById("card-front-content").textContent = frontContent;
    document.getElementById("card-front-phonetic").textContent = w.phonetic || "";
    document.getElementById("card-hint-text").textContent = st.phase === 'hint' ? "点击揭晓答案" : "点击卡片或按 空格 查看提示";
  }

  // 答案面
  document.getElementById("card-back-content").textContent = w.content;
  document.getElementById("card-back-meaning").textContent = w.meaning;
  document.getElementById("card-back-example").textContent = w.example || "";

  // 更新控制栏
  UI.renderGameControls();
}

renderGameControls(){
  const st = GameEngine.state;
  const flashGroup = document.getElementById("cr-flash-controls");
  const rapidGroup = document.getElementById("cr-rapid-controls");
  const feedbackBar = document.getElementById("cr-feedback-bar");

  // 显示对应玩法控制
  flashGroup.classList.toggle("hidden", st.mode !== "flash-recall");
  rapidGroup.classList.toggle("hidden", st.mode !== "rapid-response");

  // 揭晓按钮文本
  const advanceBtn = document.querySelectorAll('[data-action="advance"]');
  const label = st.phase === 'ready' ? "🔍 查看提示" : st.phase === 'hint' ? "揭晓答案" : "已完成";
  advanceBtn.forEach(b => { b.textContent = label; b.disabled = st.phase === 'answer' || st.phase === 'feedback'; });

  // 反馈栏：在 answer + feedback 阶段显示
  const showFeedback = st.phase === 'answer' || st.phase === 'feedback';
  feedbackBar.classList.toggle("hidden", !showFeedback);

  // 下一题按钮：在 feedback 阶段可用
  const nextBtns = document.querySelectorAll('[data-action="next-word"]');
  nextBtns.forEach(b => b.disabled = st.phase !== 'feedback' && st.phase !== 'ready');

  // 抢答模式按钮状态
  if (st.mode === "rapid-response") {
    const cBtn = document.querySelector('[data-action="judge-correct"]');
    const wBtn = document.querySelector('[data-action="judge-weak"]');
    if (cBtn) cBtn.disabled = !st.selectedStudentId;
    if (wBtn) wBtn.disabled = !st.selectedStudentId;
  }
}
```

- [ ] **Step 4: 更新键盘快捷键**

```javascript
document.addEventListener("keydown", (e) => {
  if (UI.isModalOpen()) {
    if (e.key === "Escape" && UI.modalStack[UI.modalStack.length - 1] !== "firstrun") {
      UI.closeTopModal();
      e.preventDefault();
    }
    return;
  }
  const st = GameEngine.state;
  if (!st.active) return;
  if (e.code === "Space") { e.preventDefault(); GameEngine.advance(); }
  else if (e.key === "Enter") { e.preventDefault(); GameEngine.next(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); GameEngine.prev(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); GameEngine.next(); }
  else if (e.key === "Escape") { e.preventDefault(); GameEngine.exit(); }
});
```

- [ ] **Step 5: 更新 CSS 适应三层布局**

```css
/* 新增样式 */
.cr-meta, .cr-status, .cr-actions {
  display: flex; align-items: center; gap: 14px;
}
.cr-streak {
  background: linear-gradient(90deg, #ff6a00, #ffb84d);
  color: #1a0a00; border-radius: 999px; padding: 4px 16px;
  font-size: 18px; font-weight: 800; white-space: nowrap;
}
.cr-timer { color: var(--text-dim); font-size: 18px; font-weight: 700; }
.card-label {
  position: absolute; top: 14px; left: 20px;
  background: var(--card-2); border: 1px solid var(--line);
  border-radius: 999px; padding: 2px 14px;
  font-size: 16px; color: var(--text-dim); font-weight: 600;
}
.cr-controls {
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 16px 24px 22px; flex-shrink: 0;
}
.cr-controls-group {
  display: flex; align-items: center; justify-content: center;
  gap: 12px; flex-wrap: wrap;
}
.cr-feedback-bar {
  display: flex; align-items: center; justify-content: center;
  gap: 12px; padding: 12px 20px;
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  width: 100%; max-width: 800px;
}
.cr-feedback-label {
  font-size: 18px; font-weight: 700; color: var(--text-dim);
  margin-right: 8px; white-space: nowrap;
}
/* 一体机按钮优化 */
.cr-controls .btn { min-height: 72px; font-size: 24px; min-width: 120px; }
.cr-feedback-bar .btn { min-height: 64px; font-size: 20px; flex: 1; max-width: 200px; }
/* 点击整张卡片翻牌 */
#flip-card { cursor: pointer; }
```

- [ ] **Step 6: Run smoke tests (部分已知失败)**

Run: `node _dev/smoke.js` — 已知 Classroom 部分测试需要更新，但核心模块（Store/ItemBank/ReviewPool/Session）应通过

- [ ] **Step 7: Commit**

```bash
git add speedword-classroom.html
git commit -m "feat(v3): GameEngine state machine and 3-zone classroom UI"
```

---

### Task 5: Flash Recall 玩法重构 + Rapid Response 玩法实现

**Files:**
- Modify: `speedword-classroom.html` — 课堂设置新增玩法选择，完善两种玩法流程
- Test: `_dev/smoke.js` — 更新课堂测试

- [ ] **Step 1: 更新课堂设置（Setup）**

```html
<div class="field">
  <label>课堂玩法</label>
  <div class="seg" id="setup-mode">
    <button class="seg-btn active" data-mode="flash-recall">闪记挑战</button>
    <button class="seg-btn" data-mode="rapid-response">抢答风暴</button>
  </div>
</div>
```

更新 Setup：

```javascript
const Setup = {
  packId: null,
  mode: "flash-recall",   // flash-recall | rapid-response
  order: "shuffle",
  direction: "word-to-meaning"
};
```

- [ ] **Step 2: 完善 Flash Recall 流程**

Flash Recall 流程：
1. `ready`: 显示线索（英⇄中）+ "查看提示"按钮
2. `hint`: 显示音标 + "揭晓答案"按钮
3. `answer`: 翻牌显示答案面 + TTS 发音 + 班级反馈按钮出现
4. `feedback`: 教师点击全班掌握/部分掌握/再练一次
5. 自动进入下一题或等待教师点击"下一题"

在 GameEngine 中添加对翻牌动画的 transitionend 稳妥处理。

- [ ] **Step 3: 完善 Rapid Response 玩法**

Rapid Response 在 Flash Recall 基础上增加：
1. 显示线索后出现倒计时（默认 5 秒计时器）
2. 教师可点击"随机抽人"选择学生回答
3. 用"答对/存疑"按钮替代班级反馈
4. 倒计时结束自动揭晓

```javascript
// 在 GameEngine 中添加计时器
startTimer(){
  const st = GameEngine.state;
  st.timer = 5;
  UI.renderTimer();
  if (st._timerInterval) clearInterval(st._timerInterval);
  st._timerInterval = setInterval(() => {
    st.timer--;
    UI.renderTimer();
    if (st.timer <= 0) {
      clearInterval(st._timerInterval);
      st._timerInterval = null;
      // 自动揭晓
      if (st.phase === 'hint') GameEngine.advance();
    }
  }, 1000);
}
```

- [ ] **Step 4: 更新 UI.renderTimer()**

```javascript
renderTimer(){
  const st = GameEngine.state;
  const el = document.getElementById("cr-timer");
  if (st.mode === "rapid-response" && st.phase === 'hint' && st.timer > 0) {
    el.textContent = "⏱ " + st.timer + "s";
    el.style.display = "inline";
  } else {
    el.style.display = "none";
  }
}
```

- [ ] **Step 5: 更新玩法名称在 App 和 Setup 事件中**

```javascript
// 更新 App.startClass()
startClass(){
  const pack = ItemBank.get(Setup.packId);
  if (!pack) { UI.toast("请先选择词包", "err"); return; }
  if (!pack.items.length) { UI.toast("该词包还没有内容，请先添加或导入", "err"); return; }
  if (Setup.mode === "rapid-response" && !Students.enabledList().length) {
    UI.toast("抢答风暴需要至少一名可用学生", "err"); return;
  }
  GameEngine.start({
    pack: pack,
    mode: Setup.mode,
    direction: Setup.direction,
    shuffled: Setup.order === "shuffle"
  });
}
```

- [ ] **Step 6: 更新抢答模式的键盘支持**

```javascript
// 在 keydown 处理中
else if (e.key === "s" || e.key === "S") { e.preventDefault(); if (st.mode === "rapid-response") GameEngine.pickStudent(); }
else if (e.key === "g" || e.key === "G") { e.preventDefault(); if (st.mode === "rapid-response") GameEngine.judge("correct"); }
else if (e.key === "r" || e.key === "R") { e.preventDefault(); if (st.mode === "rapid-response") GameEngine.judge("weak"); }
```

- [ ] **Step 7: Run smoke tests**

Run: `node _dev/smoke.js` — 修复已知失败的课堂测试

- [ ] **Step 8: Commit**

```bash
git add speedword-classroom.html _dev/smoke.js
git commit -m "feat(v3): Flash Recall and Rapid Response game modes"
```

---

### Task 6: 更新演示数据播种 + Importer 适配 V3

**Files:**
- Modify: `speedword-classroom.html` — seedDemo, Importer
- Test: `_dev/smoke.js` — 更新导入测试

- [ ] **Step 1: 更新 seedDemo 使用 V3 数据模型**

```javascript
function seedDemo(){
  const d = Store.data;
  const now = Utils.now();
  const pack = {
    id: Utils.uid("pack"),
    name: DEMO_PACK.name,
    description: DEMO_PACK.description,
    items: DEMO_PACK.items.map(w => ({
      id: Utils.uid("item"),
      type: w.type || "word",
      content: w.content,
      phonetic: w.phonetic || "",
      meaning: w.meaning,
      example: w.example || "",
      tags: [],
      difficulty: 2,
      createdAt: now,
      updatedAt: now
    })),
    createdAt: now,
    updatedAt: now
  };
  d.packs = [pack];
  d.students = DEMO_STUDENTS.map(name => ({
    id: Utils.uid("student"),
    name: name,
    enabled: true,
    callCount: 0,
    correctCount: 0,
    weakCount: 0
  }));
  d.sessions = [];
  d.reviewPool = [];
  d.statistics = defaultAppData().statistics;
  Store.save();
}
```

- [ ] **Step 2: 更新 Importer 适配 V3**

Importer 使用 `content` 替代 `word`，同时保持向后兼容：

```javascript
// parseTXT: 第一列 → content（不再叫 word）
// parseCSV: word 列 → content 列，兼容旧表头 "word"
const parseTXT = ... // 同旧逻辑但输出 { content, phonetic, meaning, example }
const parseCSV = ... // 同旧逻辑但 header "word" 映射到 content
// parseJSON: 兼容旧格式 { word: ... } 和新格式 { content: ... }
parseJSON(text){
  let data;
  try { data = JSON.parse(text); } catch (e) {
    return { fatal: "导入失败：JSON 文件格式不正确。\n请检查文件后重新导入。" };
  }
  if (!Array.isArray(data)) {
    return { fatal: "导入失败：JSON 根节点应为数组（例如 [{content, meaning, ...}]）。" };
  }
  const items = [], skipped = [];
  data.forEach((it, i) => {
    if (!it || typeof it !== "object") { skipped.push({ line: i + 1, reason: "不是对象" }); return; }
    const content = String(it.content || it.word || "").trim();
    const meaning = String(it.meaning || "").trim();
    if (!content) { skipped.push({ line: i + 1, reason: "缺少内容" }); return; }
    if (!meaning) { skipped.push({ line: i + 1, reason: "缺少中文释义" }); return; }
    items.push({
      type: it.type || "word",
      content,
      phonetic: String(it.phonetic || "").trim(),
      meaning,
      example: String(it.example || "").trim()
    });
  });
  return { items, skipped };
}
```

- [ ] **Step 3: Run smoke tests**

Run: `node _dev/smoke.js` — 所有导入测试应通过

- [ ] **Step 4: Commit**

```bash
git add speedword-classroom.html
git commit -m "feat(v3): seedDemo and Importer adapted for V3 data model"
```

---

### Task 7: 同步更新所有 UI 渲染函数适配 V3

**Files:**
- Modify: `speedword-classroom.html` — 更新所有 UI.render* 方法
- Test: `_dev/smoke.js` — 更新 UI 测试

- [ ] **Step 1: 更新 renderHome、renderPacks、renderPackDetail 使用 V3 数据**

主要变更：
- `totalWords` → `totalItems`
- `p.words` → `p.items`
- `w.word` → `w.content`
- `w.status` → 移除（不再渲染 badge green/red）
- 统计显示 `weakCount` → 从 reviewPool 获取

```javascript
renderHome(){
  const d = Store.data;
  const totalItems = d.packs.reduce((s, p) => s + p.items.length, 0);
  document.getElementById("stat-packs").textContent = d.packs.length + " 个词包 · " + totalItems + " 项";
  document.getElementById("stat-students").textContent = d.students.length + " 名学生";
  document.getElementById("stat-weak").textContent = d.reviewPool.length + " 个待复习";
  document.getElementById("stat-settings").textContent = d.settings.soundEnabled ? "音效开" : "音效关";
}

renderPackDetail(packId){
  const p = ItemBank.get(packId);
  if (!p) { UI.showView("packs"); return; }
  document.getElementById("pack-detail-name").textContent = p.name;
  const list = document.getElementById("word-list");
  list.innerHTML = "";
  if (!p.items.length) {
    list.appendChild(el("div", "weak-empty", "该词包还没有内容，点击右上角「添加内容」或「批量导入」"));
  } else {
    p.items.forEach(w => {
      const row = el("div", "list-row");
      const main = el("div", "row-main");
      const typeTag = el("span", "", typeLabel(w.type) + " ");
      const title = el("div", "row-title");
      title.append(typeTag, document.createTextNode(w.content + (w.phonetic ? "  " + w.phonetic : "")));
      const sub = el("div", "row-sub", w.meaning + (w.example ? " · " + w.example : ""));
      main.append(typeTag);
      // 简化：使用 textContent
      const edit = el("button", "btn btn-ghost", "编辑"); edit.dataset.action = "edit-word-row"; edit.dataset.wordId = w.id;
      const del = el("button", "btn btn-danger", "删除"); del.dataset.action = "del-word-row"; del.dataset.wordId = w.id;
      row.append(main, typeTag, edit, del);
      list.appendChild(row);
    });
  }
}
```

- [ ] **Step 2: 更新单词编辑模态框适配 V3**

新增 type 选择器和 content 字段替代 word：

```html
<div class="field">
  <label>类型</label>
  <div class="seg" id="w-type">
    <button class="seg-btn active" data-type="word">单词</button>
    <button class="seg-btn" data-type="phrase">词组</button>
    <button class="seg-btn" data-type="sentence">句子</button>
  </div>
</div>
<div class="field">
  <label>英文内容 *</label>
  <input type="text" id="w-content" placeholder="apple 或 take care">
</div>
<!-- 保留音标、释义、例句字段 -->
```

更新 `openWordModal`、`saveWord` 使用新字段。

- [ ] **Step 3: 更新弱/复习视图（Weak → Review）**

将错题本视图改为复习池视图，显示复习池中的内容项：

```javascript
renderWeak(){
  // 保留旧弱视图但使用 reviewPool 数据
  const list = document.getElementById("weak-list");
  const empty = document.getElementById("weak-empty");
  const btn = document.getElementById("weak-review-btn");
  list.innerHTML = "";
  const pool = ReviewPool.getItems(Setup.packId || (Store.data.packs[0] ? Store.data.packs[0].id : ""));
  if (!pool.length) {
    empty.classList.remove("hidden");
    btn.disabled = true;
    return;
  }
  empty.classList.add("hidden");
  btn.disabled = false;
  pool.forEach(r => {
    if (!r.item) return;
    const row = el("div", "list-row");
    const main = el("div", "row-main");
    const title = el("div", "row-title", r.item.content);
    const sub = el("div", "row-sub", r.item.meaning + " · 原因: " + r.reasons.join(", "));
    main.append(title, sub);
    const del = el("button", "btn btn-danger", "移除");
    del.dataset.action = "weak-del"; del.dataset.packId = r.packId; del.dataset.wordId = r.itemId;
    row.append(main, del);
    list.appendChild(row);
  });
}
```

- [ ] **Step 4: Run smoke tests**

Run: `node _dev/smoke.js` — 全部测试应通过（或已知剩余失败已标记）

- [ ] **Step 5: Commit**

```bash
git add speedword-classroom.html _dev/smoke.js
git commit -m "feat(v3): UI rendering adapted for V3 data model"
```

---

### Task 8: 一体机触屏优化 + 全面测试

**Files:**
- Modify: `speedword-classroom.html` — CSS 优化
- Test: `_dev/smoke.js` — 最终测试更新

- [ ] **Step 1: 按钮高度和间距触屏优化**

```css
/* 一体机触屏优化 */
.btn {
  min-height: 72px;
  padding: 0 28px;
  font-size: 22px;
}
.btn-primary { min-height: 84px; font-size: 28px; }
.btn-sm { min-height: 56px; font-size: 18px; padding: 0 18px; }
/* 按钮间距 */
.classroom-controls, .cr-controls-group { gap: 16px; }
.seg-btn { min-height: 72px; font-size: 22px; min-width: 140px; }
/* 模态框按钮 */
.modal-actions .btn { min-height: 64px; font-size: 20px; }
```

- [ ] **Step 2: 删除 hover-only 交互**

所有关键信息不能仅通过 hover 显示。按钮状态应通过 active 状态和可见 text 表达：

```css
/* 保持 hover 作为增强，但不是唯一信息来源 */
.btn:active { transform: scale(.96); }  /* 触屏 feedback 增强 */
```

- [ ] **Step 3: 点击舞台区推进（触屏友好）**

```javascript
// 点击卡片（非按钮区域）推进
document.getElementById("flip-card").addEventListener("click", (e) => {
  // 如果点击的是按钮内部的元素，不触发
  if (e.target.closest("button")) return;
  GameEngine.advance();
});
```

- [ ] **Step 4: 全屏模式自动推荐**

在课堂开始时自动提示全屏（或在启动时全屏）：

```javascript
// 在 GameEngine.start() 末尾添加
setTimeout(() => {
  if (!document.fullscreenElement && !window.__testing) {
    try { document.documentElement.requestFullscreen(); } catch (e) {}
  }
}, 500);
```

- [ ] **Step 5: 最终烟雾测试全线通过**

```javascript
// 更新所有测试用例验证 V3 功能
// 1. 初始化与演示数据
// 2. 视图路由
// 3. Flash Recall 玩法
// 4. Rapid Response 玩法
// 5. 键盘快捷键（已适配新状态机）
// 6. 随机不重复队列
// 7. 公平抽人
// 8. 导入解析（兼容新旧格式）
// 9. 备份往返
// 10. XSS 防注入（使用 textContent）
// 11. V1→V3 迁移验证
// 12. ReviewPool 操作验证
// 13. Session 操作验证
```

Run: `node _dev/smoke.js`
预期：全部通过 ✅

- [ ] **Step 6: Commit**

```bash
git add speedword-classroom.html _dev/smoke.js
git commit -m "feat(v3): touchscreen optimization and final test updates"
```

---

### Task 9: 回顾更新 SpeedWord 桌面包装

**Files:**
- Modify: `SpeedWord/package.json`, `SpeedWord/main.js` — 如有必要
- Verify: `SpeedWord` 目录结构保持不变

- [ ] **Step 1: 验证 Electron 启动**

```bash
cd SpeedWord && npm run sync:html && npm start
```

确认新 UI 在 Electron 窗口中正常渲染，全屏功能正常。

- [ ] **Step 2: 提交（如无变更则跳过）**

- [ ] **Step 3: 整体验证并完成**

```bash
git status
git log --oneline -5
```