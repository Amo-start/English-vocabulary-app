/* 生成 SpeedWord/assets/icon.ico —— 纯 Node 实现，无外部依赖。
 * 256x256 PNG（RGBA）+ ICO 封装。蓝色圆底 + 白色播放三角。
 * 运行：node _dev/make-icon.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const W = 256, H = 256;
const px = Buffer.alloc(W * H * 4);

function pointInTri(px_, py_, a, b, c) {
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([px_, py_], a, b), d2 = sign([px_, py_], b, c), d3 = sign([px_, py_], c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

const BLUE = [77, 178, 255, 255];
const WHITE = [255, 255, 255, 255];
const cx = 128, cy = 122, R = 100;
const triA = [100, 96], triB = [158, 122], triC = [100, 148];

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const dx = x - cx, dy = y - cy;
    let c = [0, 0, 0, 0];
    if (dx * dx + dy * dy <= R * R) {
      c = pointInTri(x, y, triA, triB, triC) ? WHITE : BLUE;
    }
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
  }
}

// ---- PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8bit, RGBA
// scanlines: 每行前加 filter byte 0
const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]);

// ---- ICO 封装（单图 256x256 PNG 条目）----
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); // 1 image
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0;  // width 0 = 256
entry[2] = 0; entry[3] = 0;  // height 0 = 256 / colorcount / reserved
entry.writeUInt16LE(1, 4);   // planes
entry.writeUInt16LE(32, 6);  // bitcount
entry.writeUInt32LE(png.length, 8); // bytesInRes
entry.writeUInt32LE(22, 12);        // imageOffset = 6 (ICONDIR) + 16 (entry)

const out = Buffer.concat([header, entry, png]);
const dir = path.join(__dirname, "..", "SpeedWord", "assets");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "icon.ico"), out);
console.log("✓ 已生成 SpeedWord/assets/icon.ico (" + out.length + " bytes)");
