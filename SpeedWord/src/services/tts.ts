// 发音服务：Web Speech API TTS（离线可用）+ 词典音频兜底
export interface SpeakOpts {
  rate?: number;
  lang?: "en-US" | "en-GB";
  voice?: string;
}

let voicesCache: SpeechSynthesisVoice[] = [];

function loadVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === "undefined") return [];
  const vs = speechSynthesis.getVoices();
  if (vs.length) voicesCache = vs;
  return voicesCache;
}

if (typeof speechSynthesis !== "undefined") {
  loadVoices();
  speechSynthesis.onvoiceschanged = () => loadVoices();
}

function pickVoice(lang: "en-US" | "en-GB"): SpeechSynthesisVoice | undefined {
  const vs = loadVoices();
  const exact = vs.filter((v) => v.lang === lang);
  if (exact.length) {
    // 优先用系统推荐发音较好的（多为自然语音）
    return exact.find((v) => /google|natural|microsoft/i.test(v.name)) || exact[0];
  }
  return vs.find((v) => v.lang.startsWith("en"));
}

/** 朗读英文（可选 voice 指定具体系统声音） */
export function speak(text: string, opts: SpeakOpts = {}): void {
  if (typeof speechSynthesis === "undefined" || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = opts.lang || "en-US";
  u.rate = opts.rate ?? 0.92;
  const v = opts.voice ? voicesCache.find((x) => x.name === opts.voice) : pickVoice(u.lang as "en-US");
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

export function stopSpeak(): void {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

export function listVoices(): SpeechSynthesisVoice[] {
  return loadVoices();
}
