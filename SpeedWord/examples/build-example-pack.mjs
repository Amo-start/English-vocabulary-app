// 生成示例词包 examples/示例词包-初一U3.swpack
// 用法：node examples/build-example-pack.mjs（依赖项目 node_modules 的 jszip）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __dir = path.dirname(fileURLToPath(import.meta.url));

const now = 1765000000000; // 固定时间戳，便于产物稳定

function item(id, text, type, extra = {}) {
  return {
    id,
    packId: "sample-pack",
    sort: 0,
    type,
    text,
    phonetic: extra.phonetic || "",
    partOfSpeech: extra.pos || "",
    meaningZh: extra.meaningZh || `${text}的中文释义`,
    definitionEn: extra.definitionEn || `English definition of ${text}.`,
    example: extra.example || `This is ${text}.`,
    audio: { source: "none", status: "none" },
    image: extra.image || { localPath: "", sourceType: "builtin", sourceUrl: "", description: "", status: "ok", locked: false, history: [] },
    aiMeta: { generatedBy: "dictionary", generatedAt: now },
    fieldState: {
      phonetic: extra.fs?.phonetic || "auto",
      meaningZh: extra.fs?.meaningZh || "auto",
      definitionEn: extra.fs?.definitionEn || "auto",
      example: extra.fs?.example || "auto",
      image: extra.fs?.image || "auto",
      audio: extra.fs?.audio || "auto"
    },
    verified: !!extra.verified,
    locked: !!extra.locked,
    createdAt: now,
    updatedAt: now
  };
}

const items = [
  item("sample-apple", "apple", "word", {
    phonetic: "/ˈæp.əl/", pos: "n.", meaningZh: "苹果", definitionEn: "a round fruit with red or green skin",
    example: "I eat an apple every morning.",
    image: { localPath: "sw://img/sample_apple.svg", sourceType: "builtin", sourceUrl: "", description: "一个红色的苹果", status: "ok", locked: false, history: [] },
    verified: true
  }),
  item("sample-banana", "banana", "word", {
    phonetic: "/bəˈnɑː.nə/", pos: "n.", meaningZh: "香蕉", definitionEn: "a long curved fruit with yellow skin",
    example: "Monkeys like bananas.",
    image: { localPath: "sw://img/sample_banana.svg", sourceType: "builtin", sourceUrl: "", description: "一根黄色的香蕉", status: "ok", locked: false, history: [] },
    verified: true
  }),
  item("sample-look-after", "look after", "phrasal_verb", {
    phonetic: "/lʊk ˈɑːf.tər/", pos: "phr. v.", meaningZh: "照顾", definitionEn: "to take care of someone or something",
    example: "My grandma looks after my little sister.",
    fs: { meaningZh: "edited" }, // 教师手改过释义
    verified: true
  }),
  item("sample-responsibility", "responsibility", "word", {
    phonetic: "/rɪˌspɒn.səˈbɪl.ə.ti/", pos: "n.", meaningZh: "责任", definitionEn: "a duty to deal with something",
    example: "It is your responsibility to finish homework.",
    verified: false
  }),
  item("sample-take-care-of", "take care of", "phrasal_verb", {
    phonetic: "/teɪk keər əv/", pos: "phr. v.", meaningZh: "照管；负责",
    definitionEn: "to look after something or someone",
    example: "Who takes care of the dog?",
    verified: true
  }),
  item("sample-sentence", "This is my book.", "sentence", {
    phonetic: "", pos: "sentence", meaningZh: "这是我的书。",
    definitionEn: "A basic sentence using the possessive adjective.",
    example: "This is my book, and that is yours.",
    fs: { example: "locked" } // 教师锁定了例句，自动补全不得覆盖
  })
];

// 排序
items.forEach((it, i) => (it.sort = i));

const zip = new JSZip();
zip.file("manifest.json", JSON.stringify({
  format: "speedword-pack", version: 1, appVersion: "4.0.0", exportedAt: now,
  packId: "sample-pack", packName: "初一 U3 课堂词包（示例）", description: "V4 示例：涵盖单词 / 短语动词 / 句子，含内置图与字段状态演示", itemCount: items.length
}, null, 2));
zip.file("words.json", JSON.stringify(items, null, 2));

// 内嵌两张内置 SVG 素材（来自 assets/builtin-images）
const assetsDir = path.resolve(__dir, "..", "assets", "builtin-images");
zip.file("images/sample_apple.svg", fs.readFileSync(path.join(assetsDir, "builtin_apple.svg")));
zip.file("images/sample_banana.svg", fs.readFileSync(path.join(assetsDir, "builtin_banana.svg")));

// 课堂元数据（示例：复习池 + 最近一次课堂 Session）
zip.file("metadata/classroom.json", JSON.stringify({
  reviewPool: [
    { id: "rp-look-after", packId: "sample-pack", itemId: "sample-look-after", reason: "重点复习", sourceSession: "sess-1", lastMode: "quick-read", createdAt: now, lastPracticed: now }
  ],
  sessions: [
    { id: "sess-1", packId: "sample-pack", gameMode: "quick-read", className: "初一(3)班", startedAt: now, endedAt: now + 2400000, itemCount: 6, correctCount: 5, comboMax: 4, summary: { mastered: 5, review: 1 } }
  ]
}, null, 2));

const out = path.join(__dir, "示例词包-初一U3.swpack");
const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
fs.writeFileSync(out, buffer);
console.log("已生成:", out, buffer.length, "bytes");
