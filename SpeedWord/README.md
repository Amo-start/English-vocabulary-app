# 极速识词（课堂互动版）· Windows 桌面版

将根目录的单 HTML Web 版 `speedword-classroom.html` 用 Electron 包装为 Windows EXE。
**业务逻辑全部在 `index.html` 内（即根目录的源文件），本目录只负责桌面壳。**

## 目录说明
```
SpeedWord/
├─ index.html      ← 由 speedword-classroom.html 同步生成，不要直接改
├─ main.js         ← Electron 主进程（窗口 / 安全配置）
├─ preload.js      ← 安全边界（contextBridge，MVP 暂不暴露 Node 能力）
├─ sync-html.js    ← 把根目录源 HTML 同步为 index.html
├─ package.json    ← electron + electron-builder 打包配置
├─ assets/icon.ico ← 应用图标（可替换为自己的图标，保持同名即可）
└─ dist/           ← 打包产物输出目录（构建后生成）
```

## 使用流程（文档 18.8 推荐的顺序）
1. 先确认根目录 `speedword-classroom.html` 在浏览器里可正常运行。
2. 安装依赖（已执行过可跳过）：
   ```
   npm install
   ```
3. 本地运行桌面版：
   ```
   npm start
   ```
4. 构建 Windows 发布包（安装版 + 绿色版）：
   ```
   npm run dist
   ```
   产物在 `dist/` 下：
   - `极速识词 Setup <ver>.exe`（NSIS 安装版）
   - `极速识词 <ver>.exe`（Portable 绿色版）

## 修改网页内容的正确姿势
**只改根目录的 `speedword-classroom.html`**，然后重新同步：
```
npm run sync:html
```
（`npm start` / `npm run dist` 会自动同步。）

## 课堂大屏全屏
课堂视图右上角「⛶ 全屏」使用标准 Fullscreen API，浏览器与 Electron 均可使用；`Esc` 退出全屏。

## 数据说明
MVP 沿用浏览器 `LocalStorage`，断网离线可用。数据模型、JSON 备份、错题本、学生名单逻辑与 Web 版完全一致（文档 18.12）。数据规模扩大后再迁移 SQLite。

## 安全（文档 18.13）
- `contextIsolation: true`、`nodeIntegration: false`，网页内无 Node.js 能力。
- 后续如需原生文件对话框 / SQLite / 系统投影控制，一律通过 `preload.js` 的 `contextBridge` 暴露白名单 API。
