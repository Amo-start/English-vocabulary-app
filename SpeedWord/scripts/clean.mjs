// 清理构建产物
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const p of ["electron-dist", "dist", "release"]) {
  fs.rmSync(path.join(root, p), { recursive: true, force: true });
  console.log("cleaned:", p);
}
