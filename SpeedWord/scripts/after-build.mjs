// 编译 Electron 主进程后，把 sql.js 的 WASM 复制到 electron-dist，避免打包/运行时路径问题
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "sql.js", "dist", "sql-wasm.wasm");
const dstDir = path.join(root, "electron-dist");
const dst = path.join(dstDir, "sql-wasm.wasm");
if (fs.existsSync(src)) {
  fs.copyFileSync(src, dst);
  console.log("copied sql-wasm.wasm -> electron-dist");
} else {
  console.error("WARN: sql-wasm.wasm not found at", src);
}
