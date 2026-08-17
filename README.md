# 极速识词（课堂互动版）· MVP

面向英语课堂投影大屏的数字单词卡互动引擎。依据《极速识词_课堂互动版_应用开发文档_整合Web与EXE发布方案_v1》实现。

## 交付物
| 路径 | 说明 |
|---|---|
| `speedword-classroom.html` | **Web MVP 唯一交付物**：单 HTML 文件，双击即可运行，无需任何构建 |
| `SpeedWord/` | Windows 桌面版：Electron + electron-builder 打包工程（NSIS 安装版 + Portable 绿色版） |
| `_dev/` | 开发辅助：jsdom 冒烟测试（`node _dev/smoke.js`）、图标生成器（`node _dev/make-icon.js`），**非交付物** |

## 快速开始（Web）
直接用浏览器打开 `speedword-classroom.html`。
首次打开自动加载演示词库「Unit 1 · Everyday English」与 8 名演示学生，点击「开始课堂」即可体验完整流程。

## 快速开始（Windows EXE）
```bash
cd SpeedWord
npm install
npm start       # 本地运行桌面版
npm run dist    # 打包 NSIS 安装版 + Portable 绿色版（产物在 SpeedWord/dist/）
```

## 已实现功能（对照文档验收标准）
- 词库管理：词包 / 单词增删改；TXT、CSV、JSON 批量导入（含成功/跳过统计与中文错误提示）；JSON 备份导出/恢复
- 教师浏览模式：巨型词卡、CSS 3D 翻牌、上一张/下一张、掌握/存疑、顺序/随机、单词↔中文两种答案方向
- 快速抢答模式：学生名单管理、公平抽人（排除上一位 + 最少次数优先 + 同次数随机）、转盘动画、答对/存疑判定
- 错题本：存疑词自动汇总、标记次数、一键进入薄弱词复习闭环
- 课堂体验：深色高对比、超大字号大按钮、键盘全流程快捷键（Space/Enter/←/→/G/R/S/Esc）、Web Audio 合成音效可关闭、`prefers-reduced-motion` 支持、全屏课堂模式
- 数据可靠：LocalStorage 即时保存、刷新不丢数据、删除需确认、用户文本一律 `textContent` 渲染防注入

## 验证
- 74 项 jsdom 冒烟测试全部通过：`cd _dev && npm install && cd .. && node _dev/smoke.js`
- 覆盖：演示数据种子、视图路由、翻牌/下一张、随机一轮不重复、公平抽人、三类导入解析、备份往返、XSS 防注入、键盘快捷键、持久化、转盘与抢答
