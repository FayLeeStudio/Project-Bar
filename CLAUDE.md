# Project Bar — Claude Code 契约

> 这是跨 session 的硬约束文件。Claude Code 每次启动必须读取并遵守。
> 会演化的完整方案 / 阶段计划 / 代码参考放在 `Doc/Design.md`,本文件只放硬规则,保持精简。
> 不确定某个改动是否违反约束时,**先提问,不要直接改**。

## 这是什么

一个透明、始终置顶的桌面叠加层("智能贴纸",Bongo-Cat 式悬浮),把数字劳动数据可视化成**马里奥赛车式的赛道小地图**:同一房间的多个用户,按一份共享指标(初期 = 键盘按键 + 鼠标点击数)在赛道上竞速。基调是轻松的派对游戏感,是"带吉祥物的工具",不是游戏引擎项目。

---

## 核心不变量

1. **赛道 = SVG `<path>`。** 赛车位置永远用
   `getPointAtLength((pct/100) * getTotalLength())` 计算。
   换任何赛道形状 = 只换 path 的 `d` 属性,**绝不**硬编码赛车坐标,不动赛车/进度逻辑。

2. **UI 与外壳解耦,方向不可反。**
   - `index.html` = 纯 Web(无框架、无构建步骤),托管在 GitHub Pages,任意设备可改。
   - Tauri 外壳只**加载** Pages 的 URL;在本地按系统构建。
   - 外壳不承载 UI 逻辑;UI 不依赖外壳才能在浏览器里跑。

3. **原生边界。**
   - 全局输入统计**只在 Rust 层**做(rdev),webview **永不**直接读全局输入。
   - webview 只通过 Tauri 事件 `keycount` **接收**计数,再映射到赛道位置。
   - 隐私:**只对输入计数**,绝不记录是哪个键/哪次点击、绝不记录任何内容。

4. **后端 = Cloudflare Workers + Durable Objects(Stage 2)。**
   后端只做一件事:把某玩家的整数进度(`ticks`)广播给同房间所有人;
   **不感知赛道形状、不感知一圈多少 ticks**。多人模式**不改** UI 的 `getPointAtLength` 逻辑。
   每个 `roomId` = 一个 Durable Object 实例。完整协议 / 服务端代码 / 部署见 `Doc/Design.md` 的「后端规范」。
   > 原定 PartyKit;因其共享域名 `partykit.dev` 撞到 Cloudflare「单域名 10000 子域名」上限、免费托管无法新部署(2026-06),改用其底层 Cloudflare Workers + DO 直连(同一套技术,免费、免自有域名)。

---

## 平台规则

- **Windows 是当前主力开发/构建目标**,macOS 之后支持。
- **Tauri 不跨平台编译**:Windows 包在 Windows 上构建,macOS 包在 macOS 上构建(或用 CI)。一套源码,两个二进制。
- UI 层(网页)跨平台免费,两端渲染一致。
- macOS 额外项(以后处理):透明需 `macOSPrivateApi: true`(影响上架);全局输入需"输入监控"授权;rdev 可能需拆独立进程。

---

## 技术栈

纯 HTML/CSS/vanilla JS · SVG 渲染 · Tauri v2(Rust)外壳 · `rdev` 全局输入 · GitHub Pages 托管 · Cloudflare Workers + Durable Objects 后端(Stage 2)。

> 改动技术栈需在 `Doc/Design.md` 说明理由。

---

## 给 Claude Code 的护栏

- **不要**给网页 UI 引入前端框架或构建步骤(必须保持 Pages 可直接编辑),除非显式批准。
- **不要**把输入统计逻辑搬进 webview。
- **不要**修改 `getPointAtLength` 的调用方式;不要硬编码赛车坐标。
- **不要**让后端感知赛道/圈长;后端只传整数 `ticks`。
- 隐私红线:只计数,不记录输入内容。

---

## 仓库结构

```
index.html          # 赛道 UI（纯 Web，Pages 托管）—— 现有
README.md
CLAUDE.md           # 本契约（必读）
Doc/Design.md       # 完整方案 / 阶段计划 / 后端规范 / 代码参考
package.json        # Tauri CLI + wrangler 工具（Web UI 仍无构建步骤）
src-tauri/          # Tauri 外壳（本地构建）—— 现有
party/server.ts     # Cloudflare Worker + Durable Object 房间后端（Stage 2）
wrangler.toml       # Cloudflare Workers 部署配置（Stage 2）
```

---

## 当前阶段完成标志（DoD）

- **Stage 1 · 单机(已完成)** = 阶段 A+B：无边框/半透明/置顶的悬浮窗口装载 Pages 赛道;
  本机真实键盘+鼠标输入驱动赛车沿赛道前进;计数持久化到本地文件。

- **Stage 2 · 多人(进行中)** = 阶段 C：同一房间多人实时竞速,Cloudflare Workers + Durable Objects 后端,URL 分享房间码。
