// 内容类型自动识别：word / phrase / phrasal_verb / sentence / expression
// 教师只需粘贴文本，系统自动分类。
import type { ContentType } from "./types";

const COMMON_PHRASAL_PARTICLES = new Set([
  "up", "down", "on", "off", "in", "out", "over", "under", "away", "back",
  "into", "through", "along", "across", "round", "around", "about", "for", "after", "of"
]);

const PHRASAL_VERB_VERBS = new Set([
  "look", "take", "get", "put", "turn", "give", "break", "bring", "call", "carry",
  "come", "cut", "drop", "find", "go", "hold", "keep", "let", "make", "pass",
  "pick", "pull", "push", "run", "set", "show", "switch", "throw", "try", "wake",
  "work", "write", "back", "blow", "check", "deal", "eat", "fall", "fill", "hand",
  "hang", "kick", "leave", "look", "mess", "move", "pay", "play", "point", "pull",
  "settle", "stick", "stop", "talk", "think", "touch", "turn", "watch", "wipe"
]);

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function isSentence(s: string): boolean {
  const t = s.trim();
  // 含谓语完整结构特征：以大写或小写开头、带标点，且包含"be/do/have + "等，或含句点
  if (/[.?!]$/.test(t)) return true;
  if (/\b(am|is|are|was|were|be|been|being)\b|\b(don't|doesn't|didn't)\b|\b(will|can|could|would|should|must|may|might)\b/i.test(t)) {
    return wordCount(t) >= 3;
  }
  // 含主语+谓语（两个以上实词且含常见动词）
  if (wordCount(t) >= 5) return true;
  return false;
}

function isPhrasalVerb(s: string): boolean {
  const parts = s.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length !== 2 && parts.length !== 3) return false;
  const verb = parts[0].replace(/[^a-z'-]/g, "");
  if (!PHRASAL_VERB_VERBS.has(verb)) return false;
  const last = parts[parts.length - 1].replace(/[^a-z'-]/g, "");
  // 2 词：verb + particle（look after）；3 词：verb(+noun)+particle（take care of / come up with）
  return COMMON_PHRASAL_PARTICLES.has(last);
}

function isExpression(s: string): boolean {
  const t = s.trim().toLowerCase();
  // 常见固定习语特征：带介词短语、所有格、固定搭配
  if (wordCount(t) <= 3 && /\b(of|to|for|with|at|in|on)\b/.test(t)) return true;
  if (/\b(break the ice|piece of cake|by the way|so far|as well|in case|at all|no matter|a lot of)\b/.test(t)) return true;
  return false;
}

/** 识别单行文本类型 */
export function detectContentType(raw: string): ContentType {
  const t = (raw || "").trim();
  if (!t) return "word";
  const n = wordCount(t);
  if (n >= 3 && isSentence(t)) return "sentence";
  if (n >= 2 && n <= 3 && isPhrasalVerb(t)) return "phrasal_verb";
  if (n <= 3 && isExpression(t) && n > 1) return "expression";
  if (n === 1) return "word";
  if (n === 2) return "phrase";
  if (n === 3 && !isSentence(t)) return "phrase";
  return "sentence";
}

export interface ParsedInputLine {
  text: string;
  type: ContentType;
  raw: string;
  invalid: boolean;
}

/**
 * 解析教师粘贴的多行内容。
 * 支持：
 *   - 每行一个词/词组/句子
 *   - "单词|中文|例句" 格式（教师已填的部分信息）
 *   - "单词\t中文" 制表符格式
 */
export function parseInputText(text: string): {
  lines: ParsedInputLine[];
  skipped: string[];
} {
  const lines: ParsedInputLine[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  const rawLines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const raw of rawLines) {
    if (/^#/.test(raw)) continue; // 注释行
    const parts = raw.split(/\t|\||;/).map((p) => p.trim());
    const content = (parts[0] || "").replace(/^\s*[-•*]\s*/, "").trim();
    if (!content) continue;
    const key = content.toLowerCase();
    if (seen.has(key)) continue; // 去重
    seen.add(key);
    // 检查是否像有效英文（含字母）
    if (!/[a-zA-Z]/.test(content)) {
      skipped.push(raw);
      continue;
    }
    lines.push({
      text: content,
      type: detectContentType(content),
      raw,
      invalid: false
    });
  }
  return { lines, skipped };
}

/** 常见类型中文标签 */
export function typeLabel(t: ContentType): string {
  const map: Record<ContentType, string> = {
    word: "单词",
    phrase: "词组",
    phrasal_verb: "短语动词",
    sentence: "句子",
    expression: "习语表达"
  };
  return map[t] || "单词";
}

export function typeEmoji(t: ContentType): string {
  const map: Record<ContentType, string> = {
    word: "🔤",
    phrase: "🔗",
    phrasal_verb: "⚙️",
    sentence: "📝",
    expression: "💬"
  };
  return map[t] || "🔤";
}
