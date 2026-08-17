/* 极速识词 · jsdom 冒烟测试
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
  await sleep(50); // 等待 DOMContentLoaded / init

  const SW = window.__SW;
  if (!SW) { console.error("未找到 __SW 句柄"); process.exit(1); }
  const { Store, WordBank, WeakBook, Students, Importer, Setup, Classroom, UI } = SW;

  const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, detail: 1 }));
  const key = (k, code) => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, code: code || k, bubbles: true, cancelable: true }));
  const closeFirstRun = () => UI.closeModal("firstrun");

  console.log("\n[1] 初始化与演示数据");
  ok(SW.Store.data.wordPacks.length === 1, "首启自动播种 1 个演示词包");
  ok(SW.Store.data.wordPacks[0].words.length === 10, "演示词包含 10 个单词");
  ok(SW.Store.data.students.length === 8, "演示学生 8 名");
  ok(!document.getElementById("firstrun").classList.contains("hidden"), "首启引导弹层已显示");
  closeFirstRun();
  ok(UI.modalStack.length === 0, "关闭首启引导");

  console.log("\n[2] 视图路由");
  UI.showView("packs");
  ok(document.getElementById("view-packs").classList.contains("active"), "切到词库管理视图");
  UI.showView("setup");
  ok(SW.Setup.packId && SW.Setup.packId === Store.data.wordPacks[0].id, "课堂设置默认选中首个词包");
  UI.showView("students");
  ok(document.getElementById("view-students").classList.contains("active"), "切到学生名单视图");
  UI.showView("weak");
  ok(document.getElementById("view-weak").classList.contains("active"), "切到错题本视图");
  ok(!document.getElementById("weak-empty").classList.contains("hidden"), "无薄弱词时显示空状态");

  console.log("\n[3] 课堂浏览模式");
  const pack = Store.data.wordPacks[0];
  Classroom.start({ pack, mode: "browse", shuffled: false });
  ok(Classroom.state.active, "课堂已启动");
  ok(document.getElementById("view-classroom").classList.contains("active"), "切到课堂视图");
  eq(Classroom.state.queue.length, 10, "顺序播放队列 = 10 词");
  ok(Classroom.cur() && Classroom.cur().word.word, "首词存在");

  // 翻牌
  const card = document.getElementById("flip-card");
  card.dispatchEvent(new window.MouseEvent("click", { bubbles: true, detail: 1 }));
  await sleep(380);
  ok(Classroom.state.flipped === true, "点击卡片 3D 翻牌成功");
  ok(Classroom.state.markedStatus === null, "翻牌不改变标记状态");

  // 下一张 / 上一张
  Classroom.next();
  eq(Classroom.state.currentIndex, 1, "下一张 → index 1");
  Classroom.prev();
  eq(Classroom.state.currentIndex, 0, "上一张 → index 0");

  // 掌握
  Classroom.markMastered();
  ok(Classroom.cur().word.status === "mastered", "掌握后单词状态 = mastered");
  ok(Classroom.state.markedStatus === "mastered", "掌握后标记角标状态");
  ok(Store.data.statistics.masteredCount >= 1, "统计已增加");
  eq(WeakBook.all().length, 0, "掌握的词不入错题本");
  Classroom.next();

  // 存疑
  Classroom.markWeak();
  ok(Classroom.cur().word.status === "weak", "存疑后单词状态 = weak");
  eq(WeakBook.all().length, 1, "存疑词进入错题本");
  WeakBook.mark(pack.id, Classroom.cur().word.id);
  eq(WeakBook.all().length, 1, "重复标记不创建重复记录");
  eq(WeakBook.all()[0].weakCount, 2, "重复标记累加 weakCount");

  console.log("\n[4] 键盘快捷键");
  key(" ", "Space");
  await sleep(380);
  ok(Classroom.state.flipped === true, "Space = 翻牌");
  key("Enter");
  eq(Classroom.state.currentIndex, 2, "Enter = 下一张");
  key("ArrowLeft");
  eq(Classroom.state.currentIndex, 1, "← = 上一张");
  key("ArrowRight");
  eq(Classroom.state.currentIndex, 2, "→ = 下一张");
  key("g");
  ok(Classroom.state.markedStatus === "mastered", "G = 掌握");
  Classroom.next();
  key("r");
  ok(Classroom.state.markedStatus === "weak", "R = 存疑");
  key("Escape");
  ok(!Classroom.state.active, "Esc = 退出课堂");

  console.log("\n[5] 随机一轮不重复");
  for (let round = 0; round < 5; round++) {
    Classroom.start({ pack, mode: "browse", shuffled: true });
    const seen = new Set();
    let dup = false;
    for (const item of Classroom.state.queue) {
      if (seen.has(item.word.id)) { dup = true; break; }
      seen.add(item.word.id);
    }
    ok(!dup && seen.size === 10, "随机播放第 " + (round + 1) + " 轮：10 词无重复");
  }

  console.log("\n[6] 公平抽人");
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
  ok(seq.length === 200, "抽取 200 次全部成功");

  console.log("\n[7] 导入解析");
  const json = Importer.parseByExt("a.json", '[{"word":"apple","meaning":"苹果","phonetic":"/a/"},{"word":"book","meaning":"书"},{"word":"bad"}]');
  eq(json.items.length, 2, "JSON：2 条有效");
  eq(json.skipped.length, 1, "JSON：1 条跳过（缺释义）");
  ok(Importer.parseByExt("x.json", "{bad").fatal, "JSON 格式错误返回中文 fatal");
  ok(String(Importer.parseByExt("x.json", "{bad").fatal).indexOf("格式不正确") >= 0, "错误信息面向教师（中文）");

  const txt = Importer.parseByExt("a.txt", "apple | /a/ | 苹果 | example\nbadline\nbanana | /b/ | 香蕉");
  eq(txt.items.length, 2, "TXT：2 条有效");
  eq(txt.skipped.length, 1, "TXT：缺释义行被跳过");
  eq(txt.items[0].example, "example", "TXT 例句列解析正确");

  const csv = Importer.parseByExt("a.csv", 'word,phonetic,meaning,example\napple,/a/,苹果,"I eat an, apple."\n,缺词,无');
  eq(csv.items.length, 1, "CSV：1 条有效（含带逗号引号字段）");
  eq(csv.items[0].example, "I eat an, apple.", "CSV 引号字段解析正确");
  eq(csv.skipped.length, 1, "CSV：缺单词行跳过");

  console.log("\n[8] 备份往返");
  const beforePacks = Store.data.wordPacks.length;
  const r1 = Store.importBackup(Store.exportJSON());
  ok(r1.ok, "导出→导入往返成功");
  eq(Store.data.wordPacks.length, beforePacks, "词包数量保持一致");
  const r2 = Store.importBackup("{ not json");
  ok(!r2.ok && String(r2.error).indexOf("格式不正确") >= 0, "损坏 JSON 给出中文错误");
  const r3 = Store.importBackup("[]");
  ok(!r3.ok, "非对象根节点被拒绝");

  console.log("\n[9] XSS 防注入");
  const evilPack = WordBank.create("evil", "");
  const evilWord = WordBank.addWord(evilPack.id, { word: '<img src=x onerror=alert(1)>', meaning: '<b>加粗</b>', example: "x" });
  ok(!!evilWord, "可添加含标签文本的单词");
  App_showPack(window, UI, evilPack.id);
  const rows = document.querySelectorAll("#word-list .list-row");
  const titleEl = rows[0].querySelector(".row-title");
  eq(titleEl.textContent, '<img src=x onerror=alert(1)>', "单词以纯文本渲染（无 innerHTML 注入）");
  ok(document.querySelectorAll("#word-list img").length === 0, "页面未生成 img 元素（XSS 被阻断）");
  const evilStudent = Students.add('<script>alert(2)</script>', true);
  ok(!!evilStudent, "可添加含标签的学生名");
  UI.showView("students");
  ok(document.querySelectorAll("#student-list script").length === 0, "学生名未注入 script");

  console.log("\n[10] 持久化");
  Store.data.settings.soundEnabled = false;
  Store.save();
  const raw = window.localStorage.getItem("speedword_classroom_data");
  ok(raw && raw.indexOf("wordPacks") >= 0, "数据已写入 LocalStorage");
  Store.data.settings.soundEnabled = true;
  const had = Store.load();
  ok(had === true, "Store.load() 可读回已保存数据");
  eq(Store.data.settings.soundEnabled, false, "读回后保留上次设置");

  console.log("\n[11] 转盘动画与抢答");
  const pack2 = Store.data.wordPacks[0];
  Classroom.start({ pack: pack2, mode: "quiz", shuffled: true });
  ok(document.getElementById("cr-quiz-controls").classList.contains("hidden") === false, "抢答控制栏显示");
  ok(document.getElementById("cr-browse-controls").classList.contains("hidden") === true, "浏览控制栏隐藏");
  Classroom.pickStudent();
  ok(Classroom.state.selectedStudentId, "抽人后选中一名学生");
  const wheel = document.getElementById("quiz-wheel");
  ok(!wheel.classList.contains("hidden"), "转盘动画中");
  await sleep(1350);
  ok(wheel.classList.contains("hidden"), "转盘动画结束回到卡面");
  const banner = document.getElementById("quiz-pick");
  ok(!banner.classList.contains("hidden"), "学生姓名横幅显示");
  const judgeBtn = document.querySelector('[data-action="judge-correct"]');
  ok(judgeBtn.disabled === false, "抽人后答对按钮可用");
  Classroom.judge("correct");
  ok(Store.data.statistics.masteredCount >= 1, "答对计入统计");
  ok(Classroom.state.selectedStudentId === null, "判定后清除选中学生");
  ok(banner.classList.contains("hidden"), "判定后横幅隐藏");

  console.log("\n[12] 导入写入合并与统计");
  const importPack = WordBank.create("import-test", "");
  const res = WordBank.mergeImport(importPack.id, [
    { word: "cat", meaning: "猫" },
    { word: "dog", meaning: "狗" },
    { word: "cat", meaning: "猫" } // 重复
  ]);
  eq(res, 2, "合并导入：2 条新增（重复跳过）");

  console.log("\n======================");
  console.log("通过 " + passed + " · 失败 " + failed);
  console.log("======================");
  if (failed > 0) process.exit(1);
}

function App_showPack(window, UI, packId) {
  UI.showView("pack", packId);
}

main().catch(e => { console.error(e); process.exit(1); });
