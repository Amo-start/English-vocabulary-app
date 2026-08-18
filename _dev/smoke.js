/* 极速识词 V3 · jsdom 冒烟测试
 * 运行：node _dev/smoke.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const HTML_PATH = path.join(__dirname, "..", "speedword-classroom.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.log("  ✗ FAIL: " + name); }
}
function eq(a, b, name) { ok(a === b, name + "  (got: " + JSON.stringify(a) + ") " + (a === b ? "" : "expected: " + JSON.stringify(b))); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "dangerously",
    pretendToBeVisual: true
  });
  const { window } = dom;
  const { document } = window;
  await sleep(50);

  const SW = window.__SW;
  if (!SW) { console.error("未找到 __SW 句柄"); process.exit(1); }
  const { Utils, Store, ItemBank, ReviewPool, Session, Students, Importer, Setup, GameEngine, UI } = SW;

  const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, detail: 1 }));
  const key = (k, code) => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, code: code || k, bubbles: true, cancelable: true }));
  const closeFirstRun = () => UI.closeModal("firstrun");

  console.log("\n[1] V3 数据模型与初始化");
  ok(Store.data.version === 3, "Store version = 3");
  ok(!!Store.data.packs, "packs 数组存在");
  ok(!!Store.data.sessions, "sessions 数组存在");
  ok(!!Store.data.reviewPool, "reviewPool 数组存在");
  ok(Store.data.wordPacks === undefined, "wordPacks 已不复存在");
  ok(Store.data.packs.length === 1, "首启自动播种 1 个演示词包");
  ok(Store.data.packs[0].items.length === 12, "演示词包含 12 项内容（10 单词 + 1 词组 + 1 句子）");
  ok(Store.data.packs[0].items[0].type === "word", "演示词条 type = word");
  ok(Store.data.packs[0].items[10].type === "phrase", "演示词条 11 type = phrase");
  ok(Store.data.packs[0].items[11].type === "sentence", "演示词条 12 type = sentence");
  ok(Store.data.packs[0].items[0].content === "apple", "演示词条 content = apple");
  ok(Store.data.packs[0].items[0].status === undefined, "演示词条无 status 字段（不再永久标记）");
  ok(Store.data.students.length === 8, "演示学生 8 名");
  ok(Store.data.sessions.length === 0, "sessions 初始为空");
  ok(Store.data.reviewPool.length === 0, "reviewPool 初始为空");
  ok(!document.getElementById("firstrun").classList.contains("hidden"), "首启引导弹层已显示");
  closeFirstRun();
  ok(UI.modalStack.length === 0, "关闭首启引导");

  console.log("\n[2] V1→V3 自动迁移");
  window.localStorage.removeItem("speedword_classroom_data");
  window.localStorage.setItem("speedword_classroom_data", JSON.stringify({
    version: 1,
    settings: { theme: "dark", soundEnabled: true, autoNext: false },
    wordPacks: [{
      id: "v1-pack", name: "V1 Demo", description: "",
      words: [{ id: "v1-word", word: "apple", phonetic: "/a/", meaning: "苹果", example: "I eat an apple.", status: "mastered", createdAt: 0, updatedAt: 0 }]
    }],
    students: [{ id: "s1", name: "小明", enabled: true, callCount: 0, correctCount: 0, weakCount: 0 }],
    weakWords: [{ wordId: "v1-word", packId: "v1-pack", word: "apple", meaning: "苹果", lastMarkedAt: 0, weakCount: 1 }],
    statistics: { totalReviewed: 1, masteredCount: 1, weakCount: 0 }
  }));
  const loaded = Store.load();
  ok(loaded === true, "V1 数据可加载");
  ok(Store.data.version === 3, "加载后版本变为 3");
  ok(Store.data.packs.length === 1, "迁移后 packs 有 1 个");
  ok(Store.data.packs[0].items.length === 1, "迁移后 items 有 1 条");
  ok(Store.data.packs[0].items[0].type === "word", "迁移后 item.type = word");
  ok(Store.data.packs[0].items[0].content === "apple", "迁移后 item.content = apple");
  ok(Store.data.packs[0].items[0].status === undefined, "迁移后 item.status 不存在");
  ok(Store.data.packs[0].items[0].phonetic === "/a/", "迁移后保留音标");
  ok(Store.data.students.length === 1, "迁移后学生存在");
  ok(Store.data.reviewPool.length === 1, "迁移后 reviewPool 含 1 条旧 weakWords");
  ok(Store.data.reviewPool[0].reasons.includes("teacher-marked"), "迁移后 reviewPool 原因正确");
  ok(Store.data.settings.soundEnabled === true, "迁移后设置保留");

  // 恢复演示数据
  SW.seedDemo();
  ok(Store.data.packs.length === 1, "seedDemo 恢复演示词包");
  ok(Store.data.packs[0].items.length === 12, "seedDemo 恢复 12 项");

  console.log("\n[3] 视图路由");
  UI.showView("packs");
  ok(document.getElementById("view-packs").classList.contains("active"), "切到词库管理视图");
  UI.showView("setup");
  ok(Setup.packId && Setup.packId === Store.data.packs[0].id, "课堂设置默认选中首个词包");
  UI.showView("students");
  ok(document.getElementById("view-students").classList.contains("active"), "切到学生名单视图");
  UI.showView("weak");
  ok(document.getElementById("view-weak").classList.contains("active"), "切到复习池视图");
  ok(!document.getElementById("weak-empty").classList.contains("hidden"), "无复习内容时显示空状态");

  console.log("\n[4] ItemBank CRUD");
  const itemPack = ItemBank.create("Item Test", "V3 item pack");
  ok(!!itemPack, "ItemBank.create 成功");
  ok(itemPack.items.length === 0, "新建词包 items 为空");
  ok(itemPack.id.length > 0, "词包有 id");

  const item1 = ItemBank.addItem(itemPack.id, {
    type: "phrase", content: "take care", phonetic: "/teɪk keər/",
    meaning: "保重；小心", example: "Take care!"
  });
  ok(!!item1, "addItem 成功");
  ok(item1.type === "phrase", "addItem 保留 type=phrase");
  ok(item1.content === "take care", "addItem 保留 content");
  ok(item1.status === undefined, "新 item 无 status 字段");

  const item2 = ItemBank.addItem(itemPack.id, {
    type: "sentence", content: "How are you?", phonetic: "/haʊ ɑːr juː/",
    meaning: "你好吗？"
  });
  ok(!!item2, "addItem 句子成功");
  ok(itemPack.items.length === 2, "词包现在 2 个 items");

  const updated = ItemBank.updateItem(itemPack.id, item1.id, { meaning: "保重；一路平安" });
  ok(updated.meaning === "保重；一路平安", "updateItem 成功");

  ItemBank.removeItem(itemPack.id, item1.id);
  ok(ItemBank.get(itemPack.id).items.length === 1, "removeItem 后 items 为 1");

  const added = ItemBank.mergeImport(itemPack.id, [
    { content: "apple", meaning: "苹果", type: "word" },
    { content: "apple", meaning: "苹果", type: "word" }, // 重复
    { content: "book", meaning: "书", type: "word" },
    { word: "cat", meaning: "猫" }  // 兼容旧格式
  ]);
  ok(added === 3, "mergeImport 合并 3 条新（1 条重复跳过，兼容旧格式 word 字段）");

  ItemBank.remove(itemPack.id);
  ok(ItemBank.get(itemPack.id) === undefined, "remove 后词包不存在");

  console.log("\n[5] ReviewPool");
  const rpPack = ItemBank.create("RP Test", "");
  const rpItem = ItemBank.addItem(rpPack.id, { content: "test", meaning: "测试", type: "word" });
  ok(ReviewPool.all().length === 0, "ReviewPool 初始为空");
  ReviewPool.add(rpItem.id, rpPack.id, "teacher-marked");
  ok(ReviewPool.all().length === 1, "add 后长度 = 1");
  ok(ReviewPool.all()[0].reasons.includes("teacher-marked"), "原因记录正确");
  ReviewPool.add(rpItem.id, rpPack.id, "multiple-wrong");
  ok(ReviewPool.all()[0].reasons.length === 2, "同一 item 的多个原因累加");
  ok(ReviewPool.all()[0].count === 2, "count 累加正确");
  ReviewPool.remove(rpItem.id, rpPack.id);
  ok(ReviewPool.all().length === 0, "remove 后清空");

  // 批量 getItems
  const rpItem2 = ItemBank.addItem(rpPack.id, { content: "hello", meaning: "你好", type: "word" });
  ReviewPool.add(rpItem2.id, rpPack.id, "long-unseen");
  const items = ReviewPool.getItems(rpPack.id);
  ok(items.length === 1, "getItems 返回 1 条");
  ok(items[0].item.content === "hello", "getItems 包含完整 item 对象");
  ReviewPool.clear();
  ok(ReviewPool.all().length === 0, "clear 后清空");

  console.log("\n[6] Session");
  const sid = Session.create("Class 1", rpPack.id, "flash-recall");
  ok(!!sid, "Session.create 返回 id");
  let session = Session.get(sid);
  ok(!!session, "Session.get 找到");
  ok(session.className === "Class 1", "className 正确");
  ok(session.itemResults.length === 0, "itemResults 初始为空");
  Session.recordResult(sid, rpItem2.id, "mastered", 10, 8);
  session = Session.get(sid);
  ok(session.itemResults.length === 1, "recordResult 添加一条");
  ok(session.itemResults[0].classSignal === "mastered", "classSignal = mastered");
  Session.recordResult(sid, rpItem2.id, "partial", 10, 6);
  session = Session.get(sid);
  ok(session.itemResults.length === 1, "重复 recordResult 更新而非新增");
  ok(session.itemResults[0].classSignal === "partial", "更新后 classSignal = partial");
  Session.end(sid);
  session = Session.get(sid);
  ok(!!session.endedAt, "end 后 endedAt 有值");

  console.log("\n[7] GameEngine — Flash Recall 玩法");
  const pack = Store.data.packs[0];
  GameEngine.start({ pack, mode: "flash-recall", direction: "word-to-meaning", shuffled: false });
  ok(GameEngine.state.active, "课堂已启动");
  ok(document.getElementById("view-classroom").classList.contains("active"), "切到课堂视图");
  ok(GameEngine.state.phase === 'ready', "初始 phase = ready");
  await sleep(50);

  // Check we have content rendered
  const currentItem = GameEngine.cur();
  ok(!!currentItem, "游戏引擎当前 item 存在");
  ok(!!currentItem.item, "currentItem 包含 item 对象");
  eq(GameEngine.state.queue.length, 12, "顺序播放队列 = 12 项");

  // advance: ready → hint (no transition, immediate)
  GameEngine.advance();
  ok(GameEngine.state.phase === 'hint', "advance → phase = hint");

  // advance: hint → answer (flip animation, 750ms timeout fallback in JSDOM)
  GameEngine.advance();
  await sleep(800);  // 等待 transition timeout 兜底
  ok(GameEngine.state.answerVisible === true, "advance → answerVisible = true");
  ok(GameEngine.state.phase === 'answer', "advance → phase = answer");

  // 班级反馈
  GameEngine.setClassSignal("mastered");
  ok(GameEngine.state.streak === 1, "全班掌握 → streak = 1");

  // next (transitioning 已完成)
  GameEngine.next();
  ok(GameEngine.state.phase === 'ready', "next → phase = ready");
  ok(GameEngine.state.currentIndex === 1, "next → index = 1");

  // prev
  GameEngine.prev();
  ok(GameEngine.state.currentIndex === 0, "prev → index = 0");
  GameEngine.exit();
  await sleep(50);

  console.log("\n[8] GameEngine — Rapid Response 玩法");
  GameEngine.exit();
  await sleep(50);
  GameEngine.start({ pack, mode: "rapid-response", shuffled: false });
  ok(GameEngine.state.mode === "rapid-response", "抢答风暴模式");

  // advance to hint → timer starts
  GameEngine.advance();
  ok(GameEngine.state.phase === 'hint', "抢答 phase = hint");
  ok(GameEngine.state.timer === 5, "抢答计时器 = 5s");
  await sleep(100);

  // 抽人
  GameEngine.pickStudent();
  ok(!!GameEngine.state.selectedStudentId, "抢答抽人后选中");
  await sleep(1400);  // 等待转盘动画完成
  ok(!!GameEngine.state.selectedStudentId, "转盘结束后学生仍被选中");

  // judge
  GameEngine.judge("correct");
  ok(GameEngine.state.selectedStudentId === null, "judge 后清除选中学生");
  GameEngine.judge("correct");
  ok(GameEngine.state.selectedStudentId === null, "judge 后清除选中学生");

  console.log("\n[9] 键盘快捷键");
  GameEngine.exit();
  await sleep(50);
  GameEngine.start({ pack, mode: "flash-recall", shuffled: false });
  await sleep(50);

  key(" ", "Space");
  await sleep(380);
  ok(GameEngine.state.phase === 'hint', "Space = 推进到 hint");

  key(" ", "Space");  // hint → answer（翻牌）
  await sleep(800);  // 等待翻牌动画 timeout 完成
  ok(GameEngine.state.answerVisible === true, "Space → answerVisible = true");
  ok(!GameEngine.state.transitioning, "翻牌后 transitioning = false");

  // 先推进到 feedback 阶段，确保 setClassSignal 已走完
  GameEngine.advance();
  ok(GameEngine.state.phase === 'feedback', "advance → phase = feedback");

  key("Enter");
  await sleep(50);
  ok(GameEngine.state.currentIndex === 1, "Enter → index = 1");

  key("ArrowLeft");
  await sleep(50);
  eq(GameEngine.state.currentIndex, 0, "← → index = 0");

  key("ArrowRight");
  await sleep(50);
  eq(GameEngine.state.currentIndex, 1, "→ → index = 1");

  key("Escape");
  ok(!GameEngine.state.active, "Esc → 退出课堂");

  console.log("\n[10] 随机一轮不重复");
  for (let round = 0; round < 3; round++) {
    GameEngine.start({ pack, mode: "flash-recall", shuffled: true });
    const seen = new Set();
    let dup = false;
    for (const entry of GameEngine.state.queue) {
      if (seen.has(entry.item.id)) { dup = true; break; }
      seen.add(entry.item.id);
    }
    ok(!dup && seen.size === 12, "随机播放第 " + (round + 1) + " 轮：12 项无重复");
    GameEngine.exit();
  }

  console.log("\n[11] 公平抽人");
  Store.data.students.forEach(s => { s.callCount = 0; });
  let last = null, consecutiveSame = 0, worst = 0;
  const seq = [];
  for (let i = 0; i < 200; i++) {
    const chosen = Students.pick(last);
    seq.push(chosen.id);
    if (chosen.id === last) consecutiveSame++;
    worst = Math.max(worst, consecutiveSame);
    if (chosen.id !== last) consecutiveSame = 0;
    last = chosen.id;
  }
  ok(worst === 0, "连续 200 次抽取未出现连续同一个人");
  const counts = Store.data.students.map(s => s.callCount);
  const diff = Math.max(...counts) - Math.min(...counts);
  ok(diff <= 1, "最少/最多抽取次数差 ≤ 1（公平）  diff=" + diff);

  console.log("\n[12] 导入解析（兼容新旧格式）");
  const json = Importer.parseByExt("a.json", '[{"content":"apple","meaning":"苹果","phonetic":"/a/"},{"word":"book","meaning":"书","type":"phrase"},{"word":"bad"}]');
  eq(json.items.length, 2, "JSON：2 条有效（兼容 content 和 word 字段）");
  eq(json.skipped.length, 1, "JSON：1 条跳过（缺释义）");
  ok(Importer.parseByExt("x.json", "{bad").fatal, "损坏 JSON 给出 fatal");
  ok(String(Importer.parseByExt("x.json", "{bad").fatal).indexOf("格式不正确") >= 0, "错误信息面向教师（中文）");

  const txt = Importer.parseByExt("a.txt", "apple | /a/ | 苹果 | example\nbadline\nbanana | /b/ | 香蕉");
  eq(txt.items.length, 2, "TXT：2 条有效");
  eq(txt.skipped.length, 1, "TXT：缺释义行被跳过");
  eq(txt.items[0].content, "apple", "TXT content 解析正确");
  eq(txt.items[0].example, "example", "TXT 例句列解析正确");

  const csv = Importer.parseByExt("a.csv", 'content,phonetic,meaning,example,type\napple,/a/,苹果,"I eat an, apple.",word\n,缺词,无,,\nbook,/b/,书,,phrase');
  eq(csv.items.length, 2, "CSV：2 条有效");
  eq(csv.skipped.length, 1, "CSV：缺内容行跳过");
  ok(csv.items[0].content === "apple", "CSV content 解析正确");
  ok(csv.items[1].content === "book", "CSV 第二行 content 解析正确");
  ok(csv.items[1].type === "phrase", "CSV 第二行 type = phrase");

  console.log("\n[13] 备份往返");
  const beforePacks = Store.data.packs.length;
  const r1 = Store.importBackup(Store.exportJSON());
  ok(r1.ok, "导出→导入往返成功");
  eq(Store.data.packs.length, beforePacks, "词包数量保持不变");
  const r2 = Store.importBackup("{ not json");
  ok(!r2.ok && String(r2.error).indexOf("格式不正确") >= 0, "损坏 JSON 给出中文错误");
  const r3 = Store.importBackup("[]");
  ok(!r3.ok, "非对象根节点被拒绝");

  console.log("\n[14] XSS 防注入");
  const evilPack = ItemBank.create("evil", "");
  const evilItem = ItemBank.addItem(evilPack.id, { content: '<img src=x onerror=alert(1)>', meaning: '<b>加粗</b>', example: "x" });
  ok(!!evilItem, "可添加含标签的内容");
  UI.showView("pack", evilPack.id);
  await sleep(50);
  const rows = document.querySelectorAll("#word-list .list-row");
  const titleEl = rows[0].querySelector(".row-title");
  ok(titleEl.textContent.indexOf('<img') >= 0, "内容以纯文本渲染（无 innerHTML 注入）");
  ok(document.querySelectorAll("#word-list img").length === 0, "页面未生成 img 元素（XSS 被阻断）");
  const evilStudent = Students.add('<script>alert(2)</script>', true);
  ok(!!evilStudent, "可添加含标签的学生名");
  UI.showView("students");
  ok(document.querySelectorAll("#student-list script").length === 0, "学生名未注入 script");

  console.log("\n[15] 持久化");
  Store.data.settings.soundEnabled = false;
  Store.save();
  const raw = window.localStorage.getItem("speedword_classroom_data");
  ok(raw && raw.indexOf("packs") >= 0, "数据已写入 LocalStorage（含 packs）");
  ok(raw.indexOf("version") >= 0, "包含版本号");
  Store.data.settings.soundEnabled = true;
  const had = Store.load();
  ok(had === true, "Store.load() 可读回已保存数据");
  eq(Store.data.settings.soundEnabled, false, "读回后保留上次设置");

  console.log("\n[16] 界面按钮触屏尺寸");
  const btn = document.querySelector(".btn");
  if (btn) {
    const style = window.getComputedStyle(btn);
    const minH = parseInt(style.minHeight);
    ok(minH >= 72, "基础按钮 min-height ≥ 72px（当前 " + minH + "px）");
  }
  const segBtns = document.querySelectorAll(".seg-btn");
  if (segBtns.length) {
    const style = window.getComputedStyle(segBtns[0]);
    const minH = parseInt(style.minHeight);
    ok(minH >= 72, "分段按钮 min-height ≥ 72px（当前 " + minH + "px）");
  }

  console.log("\n======================");
  console.log("通过 " + passed + " · 失败 " + failed);
  console.log("======================");
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });