// 轻量唯一 ID（不依赖第三方）
export function uid(prefix = "id"): string {
  const rnd = () =>
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  return `${prefix}_${rnd()}`;
}

export function now(): number {
  return Date.now();
}
