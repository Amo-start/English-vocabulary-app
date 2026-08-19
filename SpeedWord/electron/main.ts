// 极速识词 V4 · Electron 主进程
// 安全：contextIsolation=true、nodeIntegration=false，渲染进程只能通过 preload 白名单 IPC 访问能力。
import { app, BrowserWindow, protocol, net, session, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import { openDatabase, type Db } from "./db";
import { registerIpc } from "./ipc";
import { mediaDir } from "./util";
import { ensureBuiltinImages } from "./images";

// 数据目录用产品名（%APPDATA%/极速识词），而非 npm 包名
app.setName("极速识词");

let db: Db | null = null;
let mainWindow: BrowserWindow | null = null;

// 自定义协议 sw://img/<file> 提供本地素材缓存
protocol.registerSchemesAsPrivileged([
  { scheme: "sw", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

function registerMediaProtocol(): void {
  protocol.handle("sw", async (request) => {
    const url = new URL(request.url);
    const host = url.host; // "img"
    const fileRel = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (host !== "img") return new Response("not found", { status: 404 });
    // 依次在 media 各子目录查找
    const candidates = [
      path.join(mediaDir(), fileRel),
      path.join(mediaDir("builtin"), fileRel),
      path.join(mediaDir("ai"), fileRel),
      path.join(mediaDir("api"), fileRel),
      path.join(mediaDir("user"), fileRel),
      path.join(mediaDir("audio"), fileRel)
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        return net.fetch(pathToFileURL(c).toString());
      }
    }
    return new Response("not found", { status: 404 });
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0f1620",
    autoHideMenuBar: true,
    title: "极速识词（课堂互动版）",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: true
    }
  });

  // 外部链接用系统浏览器打开，不在应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) e.preventDefault();
  });

  // main.js 位于 electron-dist/electron/，渲染端在项目根 dist/renderer（打包后同样结构）
  const rendererIndex = path.resolve(__dirname, "..", "..", "dist", "renderer", "index.html");
  mainWindow.loadFile(rendererIndex);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // 严格 CSP（生产与开发统一）
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: sw:; media-src 'self' data: sw: blob:; connect-src 'self'"
        ]
      }
    });
  });

  try {
    db = await openDatabase();
  } catch (e) {
    console.error("DB init failed", e);
  }
  registerMediaProtocol();
  ensureBuiltinImages();
  registerIpc(db!);

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  try {
    db?.close();
  } catch { /* noop */ }
});
