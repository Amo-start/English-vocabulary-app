# 极速识词（课堂互动版）· V3 游戏化课堂互动

面向英语课堂投影大屏 / 一体机的数字单词互动引擎。依据《极速识词_课堂互动版_V3_游戏化课堂互动与一体机优化开发文档》实现。

## 交付物
| 路径 | 说明 |
|---|---|
| `speedword-classroom.html` | **Web MVP 唯一交付物**：单 HTML 文件，双击即可运行，无需任何构建 |
| `SpeedWord/` | Windows 桌面版：Electron + electron-builder 打包工程（NSIS 安装版 + Portable 绿色版） |
| `_dev/` | 开发辅助：jsdom 冒烟测试（`node _dev/smoke.js`）、docx 解析脚本，**非交付物** |
| `docs/superpowers/` | V3 重构的设计规格（specs）与实现计划（plans） |

## 快速开始（Web）
直接用浏览器打开 `speedword-classroom.html`。
首次打开自动加载演示词包「Unit 1 · Everyday English」（12 项：10 单词 + 1 词组 + 1 句子）与 8 名演示学生，点击「开始课堂」即可体验完整流程。

旧版数据（V1）首次打开时会自动迁移到 V3 数据模型，**不会丢失任何已录数据**。

## 快速开始（Windows EXE）
```bash
cd SpeedWord
npm install
npm start       # 本地运行桌面版
npm run dist    # 打包 NSIS 安装版 + Portable 绿色版（产物在 SpeedWord/dist/）
```

## 已实现功能（对照 V3 文档验收标准）
- **V3 数据模型**：词包内为词条 `items`（`type: word / phrase / sentence`），每个词条含发音、释义、例句、标签、难度；V1 → V3 自动迁移，Importer 兼容新旧两种字段（`content` / `word`）
- **两种课堂玩法**：
  - ⚡ **闪记挑战**：翻牌回忆式 —— 先显示单词/词组/句子，翻牌揭晓释义，全班反馈（👍 掌握 / 🤔 部分掌握 / 🔄 需要再练），答对连击 streak
  - 🏆 **抢答风暴**：抽人转盘 + 5 秒倒计时，答对 / 存疑判定，S/G/R 键快速操作
- **班级反馈模型**：按词条记录当次课堂信号 `classSignal`（mastered / partial / retry / unrated），不再永久写入词条状态；`partial` / `retry` 自动进入复习池
- **复习池 ReviewPool**：取代旧「错题本」，支持多种进入原因（教师标记 / 多次错误 / 长时间未复习 / 手动加入）
- **课堂活动记录 Session**：每次课堂记录班级、词包、玩法与逐条反馈结果，可追溯复习
- **一体机触屏优化**：按钮高度 ≥72px（主操作 ≥84px）、点击卡片直接推进、移除仅 hover 交互、课堂视图全屏
- **TTS 发音**：点击音标图标即可朗读当前词条（Web Speech API）
- **词库管理**：词包 / 词条增删改；TXT、CSV、JSON 批量导入（含成功/跳过统计与中文错误提示）；JSON 备份导出/恢复
- **课堂体验**：深色高对比、超大字号大按钮、键盘全流程快捷键（`Space` 推进 / `Enter` 下一题 / `←→` 切换 / `Esc` 退出；抢答风暴中 `S` 抽人 / `G` 答对 / `R` 存疑）、Web Audio 合成音效可关闭、`prefers-reduced-motion` 支持、全屏课堂模式
- **数据可靠**：LocalStorage 即时保存、刷新不丢数据、删除需确认、用户文本一律 `textContent` 渲染防注入

## 验证
- 128 项 jsdom 冒烟测试全部通过：`cd _dev && npm install && cd .. && node _dev/smoke.js`
- 覆盖：V3 数据模型、V1→V3 自动迁移、视图路由、词条 CRUD、复习池、课堂活动记录、两种玩法状态机、键盘快捷键、随机一轮不重复、公平抽人、兼容新旧格式的导入解析、备份往返、XSS 防注入、持久化、界面按钮触屏尺寸

## 版本路线
- ✅ **V3 P0 已实现**：上述「已实现功能」全部交付
- ⬜ **V3 P1/P2 待实现**（文档中规划，暂未开发）：图片侦探（Picture Hunt）、词语搭桥（Word Bridge）、发音挑战、小组协作、学生手机端
