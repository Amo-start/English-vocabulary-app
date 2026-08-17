/* 极速识词 · preload 安全边界
 * MVP 全部使用浏览器标准 API（LocalStorage / File API / Web Audio / Fullscreen），
 * 暂不暴露任何 Node.js 能力。后续若需原生文件对话框、SQLite、系统级投影控制，
 * 应通过 contextBridge 暴露白名单 API，而不是恢复 nodeIntegration。
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  appVersion: () => "1.0.0",
  platform: process.platform
});
