// 内置 IPA-dict 词表解析与查询（en_US / en_UK）
// 数据格式（与 open-dict-data/ipa-dict 一致）：
//   word<TAB>/IPA/
// 本模块为纯函数，数据由调用方注入，便于离线与测试。

export interface IpaDictData {
  enUs: Map<string, string>;
  enUk: Map<string, string>;
  count: number;
}

/** 解析 ipa-dict 文本（逐行 word\t/IPA/） */
export function parseIpaText(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf("\t");
    if (idx <= 0) continue;
    const word = line.slice(0, idx).trim().toLowerCase();
    const ipa = line.slice(idx + 1).trim();
    if (!word || !ipa || !ipa.includes("/")) continue;
    const clean = ipa.replace(/^\/+|\/+$/g, "");
    if (clean) map.set(word, clean);
  }
  return map;
}

/** 判断一个词是否可能在 IPA 词表中（去掉标点、单复数等词形规整） */
export function normalizeForIpa(text: string): string {
  return (text || "").toLowerCase().replace(/[^a-z'-]/g, "").trim();
}

export interface IpaLookup {
  us?: string;
  uk?: string;
  found: boolean;
}

/**
 * 查询单词音标。
 * 先精确匹配；失败时尝试常见词形还原：
 *   -s / -es / -ed / -ing / -ier / -est 等。
 */
export function lookupIpa(data: IpaDictData | null, rawText: string): IpaLookup {
  if (!data) return { found: false };
  const base = normalizeForIpa(rawText);
  if (!base) return { found: false };
  const forms = wordForms(base);
  for (const f of forms) {
    const us = data.enUs.get(f);
    const uk = data.enUk.get(f);
    if (us || uk) {
      return { us, uk, found: true };
    }
  }
  return { found: false };
}

/** 生成用于匹配的词形候选（含原形） */
export function wordForms(word: string): string[] {
  const forms = new Set<string>([word]);
  const w = word;
  const tryAdd = (x: string) => { if (x && x.length > 1) forms.add(x); };
  // 去复数 / 去过去式 / 去进行式
  if (w.endsWith("ies")) tryAdd(w.slice(0, -3) + "y");
  if (w.endsWith("es")) tryAdd(w.slice(0, -2));
  if (w.endsWith("s")) tryAdd(w.slice(0, -1));
  if (w.endsWith("ied")) tryAdd(w.slice(0, -3) + "y");
  if (w.endsWith("ed")) tryAdd(w.slice(0, -2));
  if (w.endsWith("ing")) {
    tryAdd(w.slice(0, -3));
    tryAdd(w.slice(0, -4)); // 去双写
  }
  if (w.endsWith("er")) tryAdd(w.slice(0, -2));
  if (w.endsWith("est")) tryAdd(w.slice(0, -3));
  // 双写还原: stopped -> stop, running -> run
  if (/^[a-z]+([bcdfgkmnpst])\1(ed|ing)$/.test(w)) {
    tryAdd(w.slice(0, -3));
  }
  return [...forms];
}

/** 提取短语/句子中的核心词用于音标查询 */
export function headWordOf(text: string): string {
  const words = (text || "").toLowerCase().replace(/[^a-z\s'-]/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  // 跳过冠词/介词取实义词
  const stop = new Set(["a", "an", "the", "of", "to", "for", "in", "on", "at", "with", "and", "or", "but", "up", "down", "off", "out", "into", "over"]);
  const picked = words.filter((w) => !stop.has(w));
  return picked[0] || words[0];
}
