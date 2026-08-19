// 准备内置素材：生成一套干净、适合大屏投影的扁平教学插画（SVG）。
// 每张图：主体明确、背景干净、无文字、大色块、快速可识别。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "assets", "builtin-images");
fs.mkdirSync(outDir, { recursive: true });

// ---------- 小工具 ----------
const W = 640, H = 480;
const svg = (children) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">` +
  `<rect width="${W}" height="${H}" fill="#f5f7fa"/>` +
  children +
  `</svg>`;

const sky = (h = 360, top = "#bfe3ff", bottom = "#dff1ff") =>
  `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>` +
  `<rect width="${W}" height="${h}" fill="url(#sky)"/>`;

const ground = (y = 420, color = "#8fd18a") =>
  `<rect y="${y}" width="${W}" height="${H - y}" fill="${color}"/>`;

const rect = (x, y, w, h, fill, rx = 0, extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${rx}" ${extra}/>`;

const circ = (cx, cy, r, fill, extra = "") =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;

const ell = (cx, cy, rx, ry, fill, extra = "") =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;

const poly = (pts, fill, extra = "") =>
  `<polygon points="${pts.join(" ")}" fill="${fill}" ${extra}/>`;

const pth = (d, fill = "none", stroke = "#333", sw = 6, extra = "") =>
  `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;

const lne = (x1, y1, x2, y2, stroke, sw = 8) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`;

// ---------- 具体名词插画配方 ----------
const recipes = {
  apple: () => svg(sky(300) + ground(360) +
    pth(`M320 150 C 320 120 330 95 360 85 C 350 105 352 125 360 135`, "none", "#5a3d1b", 10) +
    circ(250, 300, 90, "#e53935") + circ(390, 300, 90, "#c62828") +
    ell(320, 300, 95, 88, "#ef5350") + rect(300, 130, 40, 26, "#6d4c41", 6) +
    ell(320, 295, 40, 14, "rgba(0,0,0,0.08)")),
  banana: () => svg(sky(300) + ground(360) +
    pth(`M240 350 C 200 260 250 150 380 140`, "none", "#5d4037", 10) +
    pth(`M240 350 C 230 300 245 240 270 200 C 300 160 340 140 380 140 C 355 205 330 270 330 330 C 330 348 290 355 240 350`, "#fdd835") +
    lne(270, 200, 300, 210, "#5d4037", 6) + lne(300, 210, 330, 200, "#5d4037", 6) +
    pth(`M240 350 C 230 300 245 240 270 200`, "none", "#5d4037", 7)),
  dog: () => svg(sky(300) + ground(360) +
    ell(300, 300, 95, 75, "#a1887f") + ell(270, 280, 18, 22, "#5d4037") + ell(330, 280, 18, 22, "#5d4037") +
    ell(300, 340, 40, 34, "#a1887f") + ell(300, 372, 34, 16, "#8d6e63") +
    ell(250, 300, 14, 10, "#3e2723") + ell(350, 300, 14, 10, "#3e2723") +
    circ(255, 296, 5, "#fff") + circ(345, 296, 5, "#fff") +
    poly([[280, 310], [320, 310], [300, 330]], "#795548") +
    pth(`M230 250 C 210 230 210 210 215 195 C 225 205 235 215 245 225`, "none", "#8d6e63", 12) +
    pth(`M370 250 C 390 230 390 210 385 195 C 375 205 365 215 355 225`, "none", "#8d6e63", 12) +
    pth(`M300 292 C 295 292 292 297 300 300`, "none", "#4e342e", 4)),
  cat: () => svg(sky(300) + ground(360) +
    ell(300, 330, 90, 70, "#90a4ae") +
    poly([[230, 290], [215, 250], [250, 270]], "#78909c") + poly([[370, 290], [385, 250], [350, 270]], "#78909c") +
    circ(255, 320, 12, "#263238") + circ(345, 320, 12, "#263238") + circ(259, 316, 4, "#fff") + circ(349, 316, 4, "#fff") +
    poly([[290, 338], [310, 338], [300, 352]], "#455a64") +
    pth(`M300 395 C 295 420 280 440 260 445`, "none", "#90a4ae", 12) +
    pth(`M310 395 C 310 420 320 440 340 445`, "none", "#90a4ae", 12)),
  book: () => svg(sky(320) + ground(400) +
    rect(190, 150, 260, 200, "#1e88e5", 10) +
    rect(200, 150, 20, 200, "#1565c0", 6) +
    rect(210, 170, 220, 18, "#bbdefb", 4) + rect(210, 205, 220, 12, "#90caf9", 4) + rect(210, 232, 160, 12, "#90caf9", 4) +
    rect(210, 262, 220, 12, "#90caf9", 4) + rect(210, 289, 140, 12, "#90caf9", 4) +
    rect(280, 400, 80, 16, "#5d4037", 6)),
  chair: () => svg(sky(350) + ground(420) +
    rect(230, 200, 200, 24, "#8d6e63", 6) + rect(240, 210, 20, 120, "#6d4c41") + rect(400, 210, 20, 120, "#6d4c41") +
    rect(215, 330, 230, 20, "#6d4c41", 6) + rect(250, 224, 160, 80, "#a1887f", 8)),
  water: () => svg(sky(240, "#bfe3ff", "#dff1ff") + ground(300, "#e3f2fd") +
    rect(230, 200, 220, 170, "#29b6f6", 12) + rect(220, 185, 240, 22, "#0288d1", 12) +
    pth(`M240 260 C 270 245 300 275 330 255 C 360 235 390 265 420 245`, "none", "#e1f5fe", 10) +
    circ(330, 120, 22, "#fbc02d")),
  sun: () => svg(sky(480, "#ffe082", "#fff3c4") +
    circ(320, 240, 95, "#fdd835") + circ(320, 240, 120, "none", "#ffb300", 18) +
    lne(320, 40, 320, 90, "#ffb300", 16) + lne(320, 390, 320, 440, "#ffb300", 16) +
    lne(80, 240, 130, 240, "#ffb300", 16) + lne(510, 240, 560, 240, "#ffb300", 16)),
  tree: () => svg(sky(300) + ground(400) +
    rect(300, 300, 40, 130, "#795548") +
    circ(320, 220, 90, "#43a047") + circ(250, 270, 65, "#66bb6a") + circ(390, 270, 65, "#66bb6a") +
    circ(320, 160, 60, "#2e7d32")),
  flower: () => svg(sky(300) + ground(400) +
    lne(320, 300, 320, 420, "#388e3c", 10) + ell(300, 420, 40, 12, "#66bb6a") +
    circ(320, 260, 26, "#ffca28") +
    circ(320, 210, 26, "#f06292") + circ(265, 250, 26, "#f06292") + circ(375, 250, 26, "#f06292") +
    circ(285, 300, 26, "#f06292") + circ(355, 300, 26, "#f06292")),
  car: () => svg(sky(300) + ground(380) +
    pth(`M160 320 L180 260 C 190 240 205 230 225 230 L390 230 C 410 230 425 240 435 260 L455 320 Z`, "#e53935") +
    rect(205, 240, 110, 45, "#90caf9", 8) + rect(330, 240, 90, 45, "#90caf9", 8) +
    circ(215, 335, 30, "#37474f") + circ(410, 335, 30, "#37474f") +
    circ(215, 335, 16, "#b0bec5") + circ(410, 335, 16, "#b0bec5")),
  house: () => svg(sky(300) + ground(400) +
    poly([[200, 250], [320, 150], [440, 250]], "#ef5350") +
    rect(215, 250, 210, 170, "#ffe082") +
    rect(290, 300, 60, 120, "#8d6e63") + circ(308, 330, 6, "#fbc02d") +
    rect(240, 280, 40, 40, "#90caf9", 4) + rect(360, 280, 40, 40, "#90caf9", 4)),
  ball: () => svg(sky(300) + ground(400) +
    circ(320, 290, 105, "#43a047") +
    poly([[320, 185], [380, 290], [320, 395], [260, 290]], "rgba(255,255,255,0.25)") +
    pth(`M215 290 Q 320 360 425 290`, "none", "#2e7d32", 6)),
  bird: () => svg(sky(420) + ground(440) +
    ell(300, 300, 60, 44, "#5c6bc0") + circ(340, 280, 20, "#5c6bc0") +
    poly([[360, 275], [420, 270], [365, 290]], "#f9a825") +
    circ(346, 275, 4, "#263238") + poly([[250, 300], [200, 280], [235, 315]], "#5c6bc0") +
    pth(`M285 344 C 300 400 300 400 320 344`, "none", "#f9a825", 10) +
    pth(`M305 344 C 320 380 320 380 335 344`, "none", "#f9a825", 10) +
    circ(360, 320, 6, "#e57373")),
  fish: () => svg(sky(300, "#80deea", "#e0f7fa") + ground(360, "#4db6ac") +
    ell(300, 260, 110, 55, "#ff8a65") +
    poly([[395, 260], [455, 215], [455, 305]], "#f4511e") +
    ell(260, 245, 12, 8, "#37474f") + circ(258, 245, 5, "#fff") +
    pth(`M240 260 C 215 240 190 250 175 270 C 190 285 215 285 240 265`, "none", "#ff7043", 8) +
    pth(`M300 305 C 290 340 320 350 340 380`, "none", "#26a69a", 8) + circ(350, 340, 8, "#e0f7fa")),
  milk: () => svg(sky(300) + ground(400) +
    poly([[270, 160], [330, 160], [360, 240], [360, 360], [240, 360], [240, 240]], "#eceff1") +
    poly([[270, 160], [285, 220], [315, 220], [330, 160]], "#b0bec5") +
    rect(260, 130, 80, 34, "#ef5350", 8) + rect(290, 150, 16, 26, "#ef5350", 6) +
    rect(248, 200, 104, 34, "#90caf9", 6)),
  egg: () => svg(sky(300) + ground(400) +
    ell(320, 320, 85, 120, "#ffecb3") + ell(300, 250, 18, 26, "rgba(255,255,255,0.5)") +
    ell(320, 420, 60, 10, "rgba(0,0,0,0.08)")),
  clock: () => svg(sky(320) + ground(420) +
    circ(320, 250, 130, "#fff") + circ(320, 250, 130, "none", "#37474f", 14) +
    circ(320, 250, 12, "#37474f") +
    lne(320, 250, 320, 180, "#37474f", 10) + lne(320, 250, 375, 275, "#37474f", 10) +
    lne(200, 250, 150, 250, "#78909c", 8) + lne(320, 130, 320, 80, "#78909c", 8) + lne(440, 250, 490, 250, "#78909c", 8)),
  phone: () => svg(sky(340) + ground(420) +
    rect(240, 120, 160, 300, "#37474f", 24) + rect(255, 135, 130, 250, "#eceff1", 16) +
    rect(280, 400, 80, 8, "#263238", 4) +
    circ(320, 330, 22, "#4caf50") + rect(300, 325, 40, 5, "#a5d6a7", 3)),
  cup: () => svg(sky(320) + ground(420) +
    poly([[260, 200], [380, 200], [365, 380], [275, 380]], "#ffb74d") +
    pth(`M380 240 C 430 240 430 330 365 330`, "none", "#fb8c00", 14) +
    ell(320, 190, 70, 16, "#ffe0b2") +
    pth(`M285 300 C 305 320 335 320 355 300`, "none", "#fff3e0", 10)),
  bread: () => svg(sky(320) + ground(420) +
    pth(`M230 320 L230 240 C 230 200 260 175 300 175 C 340 175 370 200 370 240 L370 320 C 370 340 350 350 300 350 C 250 350 230 340 230 320`, "#f7c15c") +
    ell(300, 175, 70, 14, "#e6a23c") +
    pth(`M270 220 L330 220 L330 260 L270 260 Z`, "none", "#e6a23c", 5)),
  pen: () => svg(sky(360) + ground(430) +
    pth(`M200 420 L380 220 L430 170 C 445 155 445 140 430 125 C 415 110 400 110 385 125 L335 175 L155 355 Z`, "#1e88e5") +
    pth(`M385 125 L430 170`, "none", "#ffb300", 10) +
    lne(205, 415, 390, 225, "#90caf9", 5)),
  bag: () => svg(sky(320) + ground(420) +
    pth(`M280 200 C 280 150 360 150 360 200`, "none", "#5d4037", 12) +
    rect(215, 200, 210, 160, "#ef5350", 16) +
    rect(260, 250, 120, 70, "#ffcdd2", 10) + lne(320, 255, 320, 315, "#c62828", 6) + lne(265, 258, 265, 312, "#c62828", 6) + lne(375, 258, 375, 312, "#c62828", 6)),
  teacher: () => svg(sky(320) + ground(420) +
    circ(320, 220, 55, "#ffcc80") +
    pth(`M320 165 C 270 160 250 190 250 215 C 250 230 260 245 280 250`, "none", "#5d4037", 10) +
    rect(240, 275, 160, 140, "#5c6bc0", 20) + rect(240, 275, 160, 60, "#3949ab", 16) +
    ell(320, 275, 60, 22, "#ffcc80")),
  student: () => svg(sky(320) + ground(420) +
    circ(320, 230, 48, "#ffe0b2") +
    pth(`M320 182 C 285 180 270 205 270 228`, "none", "#3e2723", 9) +
    rect(250, 280, 140, 130, "#8d6e63", 20) + rect(250, 280, 140, 50, "#6d4c41", 16) +
    ell(320, 280, 50, 20, "#ffe0b2")),
  school: () => svg(sky(300) + ground(400) +
    rect(170, 250, 300, 170, "#fff9c4") +
    poly([[140, 260], [320, 150], [500, 260]], "#ef5350") +
    rect(290, 300, 60, 120, "#6d4c41") +
    rect(200, 280, 50, 40, "#42a5f5", 4) + rect(390, 280, 50, 40, "#42a5f5", 4) +
    lne(140, 420, 500, 420, "#66bb6a", 14)),
  book2: () => svg(sky(320) + ground(420) +
    rect(170, 160, 300, 180, "#1e88e5", 12) + rect(170, 160, 40, 180, "#1565c0", 8) +
    rect(200, 190, 250, 20, "#bbdefb", 6) + rect(200, 235, 250, 16, "#90caf9", 6) + rect(200, 270, 180, 16, "#90caf9", 6) +
    rect(230, 380, 140, 30, "#5d4037", 8)),
  umbrella: () => svg(sky(340) + ground(440) +
    pth(`M320 120 C 220 120 165 180 155 225 L485 225 C 475 180 420 120 320 120`, "#f06292") +
    pth(`M200 225 L440 225`, "none", "#e91e63", 10) +
    lne(320, 225, 320, 400, "#5d4037", 10) +
    pth(`M320 400 C 345 420 360 430 385 440`, "none", "#5d4037", 8)),
  moon: () => svg(sky(480, "#3949ab", "#7986cb") +
    circ(320, 240, 110, "#ffd54f") +
    circ(280, 200, 100, "#3949ab") +
    circ(470, 120, 8, "#e3f2fd") + circ(510, 200, 6, "#e3f2fd") + circ(140, 320, 7, "#e3f2fd") + circ(200, 90, 5, "#e3f2fd"))
};

// ---------- 生成 ----------
const index = {};
for (const [word, fn] of Object.entries(recipes)) {
  const file = `builtin_${word}.svg`;
  fs.writeFileSync(path.join(outDir, file), fn());
  index[word] = file;
}
// 同义词别名
for (const [word, alias] of Object.entries({ milk: ["milk"], egg: ["egg"] })) void word, void alias;
fs.writeFileSync(path.join(outDir, "builtin-index.json"), JSON.stringify(index, null, 2));
console.log("builtin images:", Object.keys(index).length);
