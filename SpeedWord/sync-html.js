/* 将根目录唯一的源文件 speedword-classroom.html 同步为打包用的 index.html。
 * 开发时只改根目录的 HTML，打包前执行 npm run sync:html（或直接 npm run dist）。 */
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "speedword-classroom.html");
const dest = path.join(__dirname, "index.html");

if (!fs.existsSync(src)) {
  console.error("未找到源文件：" + src);
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log("✓ 已同步 speedword-classroom.html → index.html");
