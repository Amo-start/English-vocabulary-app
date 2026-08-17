/* 极速识词（课堂互动版）· Electron 主进程
 * 仅负责窗口 / 全屏等桌面能力；课堂业务全部在 index.html（渲染进程）内。
 * 安全：contextIsolation=true、nodeIntegration=false，不向网页暴露 Node.js。
 */
const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0e1114",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  // 大屏课堂：渲染进程通过标准 Fullscreen API 进入/退出全屏，
  // 主进程无需额外 IPC，Esc 在系统层即可退出全屏。
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
