# Project Bar — 设计与架构

> 这是**会演化**的完整方案:架构、数据流、技术选型理由、分阶段计划、关键代码参考。
> 跨会话必须守住的硬规则在 `CLAUDE.md`,本文件只补充细节与计划。
> 状态:**Stage 1(单机)已完成** · **Stage 2(多人 / PartyKit)进行中** · 主力平台 Windows。

---

## 1. 产品愿景

一个透明、置顶的桌面"智能贴纸"(Bongo-Cat 式悬浮),把数字劳动数据变成**赛道竞速**的可视化:

- 同一房间的多个用户,根据共享指标(v1 = 键盘按键 + 鼠标点击数)化身赛道上的赛车,实时竞速。
- 基调:轻松的派对游戏感。定位是**带吉祥物的工具**,不是游戏。
- 远期:小地图态 ↔ 展开面板态的双形态、赛道皮肤、自定义赛道形状。

## 2. 系统总览(三层)

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1 · Web UI (赛道)                                      │
│  纯 HTML/CSS/JS,GitHub Pages 托管,浏览器可独立运行           │
│  SVG <path> + getPointAtLength → 摆放赛车 + 排行榜            │
│  接收 keycount(本机) / 房间状态(PartyKit) → 渲染              │
└───────────────▲───────────────────────────▲─────────────────┘
                │ Tauri 事件 'keycount'      │ WebSocket(wss) 房间状态
┌───────────────┴─────────────────┐  ┌──────┴─────────────────┐
│  Layer 2 · Tauri 外壳 (Rust)     │  │  Layer 3 · 后端 PartyKit │
│  透明/无边框/置顶 原生窗口        │  │  每房间一个边缘实例       │
│  加载 Pages URL                  │  │  收某玩家 ticks → 广播    │
│  全局输入统计 (rdev)             │  │  全房间 state            │
│  写本地文件持久化                 │  │  (云;本地 partykit dev)  │
└──────────────────────────────────┘  └─────────────────────────┘
```

- **Layer 1** 在任意设备(含 iPad)上通过 Pages 迭代,跨平台免费。
- **Layer 2** 在本地按系统构建,只负责"原生能力 + 装载 UI"。
- **Layer 3** = PartyKit:每个 `roomId` 对应一个边缘实例,只转发整数,不感知赛道。

## 3. 数据模型与流转

**单机闭环(Stage 1,已完成):**

```
你打字/点击 → Rust 全局监听数到 KeyPress/ButtonPress → 累加 count
            → emit('keycount', count) 给 webview
            → webview: laps = ⌊count / PER_LAP⌋
                       progress = (count % PER_LAP) / PER_LAP
                       pt = path.getPointAtLength(progress * L) → 移动赛车
            → 每 25 次写入本地文件(app_data_dir/keycount.txt),重启恢复
```

**多人房间(Stage 2,PartyKit):**

```
本机 count → 前端节流(10fps)→ ws.send({type:'progress', ticks})
          → PartyKit 房间合并 → 广播 {type:'state', players:{id:{name,ticks}}}
          → 各端对每个玩家:pt = getPointAtLength((ticks/100) * L) → 摆位
```

每个客户端只上报**自己的** ticks;PartyKit 合并后广播完整 `players`;各端复用单机的 path 映射逻辑渲染所有赛车。详见 §8 后端规范。

## 4. 指标(metric)

- **v1 = 键盘按键 + 鼠标点击数**(rdev 的 `KeyPress` + `ButtonPress`;不含移动/滚轮/释放)。
- 设计上让"指标来源可替换"——日后可换成专注时长 / 提交数 / 步数等,渲染层不变。
- 原型为**客户端自报**;**防作弊不在原型范围内**(日后若需要,改服务端权威校验,见 §10)。

## 5. 技术选型与理由

- **为什么 Web/Tauri 而非 Unity/Godot**:产品主体是 UI(赛道 + 面板),Web 做 UI 最快;透明叠加 + 全局输入在任何路线都要按系统接原生,Web/Tauri 的原生适配面最小、最轻。引擎留给"游戏化内容显著变重"的产品化阶段再议。
- **为什么 `rdev`**:跨平台全局输入监听,能逐次捕获 KeyPress/ButtonPress 用于计数。
- **为什么 PartyKit(直接上云,跳过局域网主机原型)**:
  - "每房间一个边缘实例"与本产品的"房间"模型 1:1 对应,服务端只有几十行。
  - **本地开发无摩擦**:`npx partykit dev` 起 localhost 实例,两个浏览器标签即可联调,不需要账号/部署;验证完再 `partykit deploy` 上云。
  - 省掉了局域网主机方案的痛点(找主机 IP、同一 WiFi、放行端口、主机下线房间就没了)。
  - 底层是 Cloudflare Durable Objects,可平滑迁到自有 Cloudflare 账户。

## 6. 跨平台计划

| 层 | Windows(现在) | macOS(以后) |
|---|---|---|
| Web UI | 免费一致 | 免费一致 |
| 透明置顶 | `transparent:true` 即可 | 需 `macOSPrivateApi:true`(+ 上架限制) |
| 全局统计 | 免授权直接跑 | 需"输入监控"授权;rdev 可能需独立进程 |
| 打包 | 本机构建 .exe/.msi | **必须在 Mac 上**构建 .app/.dmg(Tauri 不跨编译) |
| 后端 | PartyKit 云,与系统无关 | 同左 |

一套源码,按系统各构建一次;UI 与后端两端共用。

## 7. 分阶段计划

> 与 `CLAUDE.md` 的 DoD 映射:**Stage 1(单机)= 阶段 A + B**;**Stage 2(多人)= 阶段 C**。

### 阶段 A · 透明置顶外壳 ✅ 已完成
- Tauri v2 外壳,窗口 `transparent/decorations:false/alwaysOnTop/skipTaskbar`,加载线上 Pages `…/#overlay`。
- 页面 `#overlay` 时背景透明;浏览器直接打开仍保暗色主题。
- 远程页面经 capability(`remote.json`)授权拖拽/关闭/事件监听,`withGlobalTauri` 暴露 `window.__TAURI__`。

### 阶段 B · 全局输入统计 + 写文件 ✅ 已完成
- `rdev` 独立 OS 线程数 `KeyPress + ButtonPress`、`emit('keycount')`、每 25 次落盘 `keycount.txt`。
- `on_page_load` 在(远程)页面加载时重投当前计数,恢复显示。
- `device_event_filter(Never)` 缓解 rdev 焦点夺键(Tauri #14770)。
- 前端 `PER_LAP = 100`(localStorage `projectbar.perlap` 可调,设置 UI 待做)。

### 阶段 C · 多人房间(PartyKit)← 当前重点
- 写 `party/server.ts` + `partykit.json`;前端加 WS 客户端(join / 节流上报 / 渲染全房间赛车)。
- **先用 `npx partykit dev` + 两个浏览器标签联调**(纯 Web,不碰 Tauri),再 `partykit deploy` 上云、用 `?room=` 分享。
- **DoD**:多端在同一房间看到彼此的赛车按各自输入数前进。
- 完整规范见 §8。

### 阶段 D · 产品化(以后)
双形态(小地图 ↔ 面板)、逐像素鼠标穿透(命中检测)、贴边吸附、赛道皮肤 / 自定义赛道、可选账号与持久化排行榜、防作弊。

---

## 8. 后端规范(PartyKit · Stage 2)

### 架构

```
[GitHub Pages UI]  ←→  WebSocket(wss)  ←→  [PartyKit Room]
                                            /parties/main/{roomId}
```

后端只有一个职责:**收到某个玩家的 ticks,广播给同房间所有人**。
不感知赛道形状,不感知一圈是多少 ticks,只传递整数。

### 进度单位

- 一圈 = 100 ticks(每次键盘/鼠标事件 +1,由前端维护)。
- 上报值为当前圈内累计 ticks(0–100 的整数);超过 100 归零进入下一圈,由前端处理,后端不关心。
- ⚠️ 排名/谁领先若要跨圈比较,需另带 `laps` 或上报累计总数 —— 见 §10 待决。

### 节流

节流在**客户端**做,服务端收到什么就广播什么。

```js
const TICK_INTERVAL_MS = 100; // 唯一需要调整的节流参数，10fps

let pendingTicks = null;

function onTick(currentTicks) {
  pendingTicks = currentTicks; // 只保留最新值
}

setInterval(() => {
  if (pendingTicks !== null && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "progress", ticks: pendingTicks }));
    pendingTicks = null;
  }
}, TICK_INTERVAL_MS);
```

### 消息协议

**客户端 → 服务端**

```ts
{ type: "join",     name: "Fay" }        // 加入房间
{ type: "progress", ticks: 42 }          // 定时上报进度
```

**服务端 → 客户端(广播)**

```ts
{
  type: "state",
  players: {
    "conn-id-abc": { name: "Fay",   ticks: 42 },
    "conn-id-xyz": { name: "Alice", ticks: 67 }
  }
}
```

### 服务端代码(`party/server.ts`)

```ts
import type * as Party from "partykit/server";

type PlayerState = { name: string; ticks: number };
type RoomState   = Record<string, PlayerState>;

export default class RaceRoom implements Party.Server {
  players: RoomState = {};

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    conn.send(JSON.stringify({ type: "state", players: this.players }));
  }

  onMessage(msg: string, sender: Party.Connection) {
    const data = JSON.parse(msg);
    if (data.type === "join") {
      this.players[sender.id] = { name: data.name, ticks: 0 };
    }
    if (data.type === "progress" && this.players[sender.id]) {
      this.players[sender.id].ticks = data.ticks;
    }
    this.room.broadcast(
      JSON.stringify({ type: "state", players: this.players })
    );
  }

  onClose(conn: Party.Connection) {
    delete this.players[conn.id];
    this.room.broadcast(
      JSON.stringify({ type: "state", players: this.players })
    );
  }
}
```

### 配置文件(`partykit.json`)

```json
{
  "name": "project-bar",
  "main": "party/server.ts"
}
```

### 前端接入要点

```js
// 从 URL 读取房间 ID（方便分享链接）
const roomId = new URLSearchParams(location.search).get("room")
            ?? Math.random().toString(36).slice(2, 8);

const ws = new WebSocket(
  `wss://project-bar.{PARTYKIT_USER}.partykit.dev/parties/main/${roomId}`
);

ws.onopen  = () => ws.send(JSON.stringify({ type: "join", name: playerName }));

ws.onmessage = ({ data }) => {
  const { type, players } = JSON.parse(data);
  if (type === "state") {
    for (const [id, { ticks }] of Object.entries(players)) {
      const pt = path.getPointAtLength((ticks / 100) * path.getTotalLength());
      // 用 pt.x / pt.y 定位对应玩家的赛车元素
    }
  }
};
```

### 部署

```bash
# 本地联调（推荐先做，无需账号）：起 localhost，两个浏览器标签连同一 room
npx partykit dev

# 方式 A：PartyKit 托管（上云起步）
npx partykit login
npx partykit deploy

# 方式 B：部署到自己的 Cloudflare 账户
CLOUDFLARE_ACCOUNT_ID=<id> CLOUDFLARE_API_TOKEN=<token> \
npx partykit deploy --domain partykit.yourdomain.com
```

### 房间分享

```
https://indiegames.design/Project-Bar/?room=abc123
# Tauri 叠加层窗口需保留 #overlay：?room=abc123#overlay
# （fayleestudio.github.io/Project-Bar/ 会 301 跳到自定义域名，等价）
```

---

## 9. 已知问题与风险

- **rdev 焦点夺键(Tauri #14770,2026 仍在)**:rdev 在 Tauri 进程内时,Tauri 窗口自身获得焦点会收不到键盘事件(鼠标正常)。缓解:`device_event_filter(Never)`;桌宠通常不抢焦点故影响小;终极方案是把监听拆成独立小进程。
- **PartyKit 远程访问**:Pages(https)连 PartyKit 必须用 `wss://`;Tauri 远程页面发起 WS 连接通常无需额外 capability(WebSocket 是标准 Web API),但需确认 CSP 不拦截。
- **macOS**:透明需私有 API(上架受限);全局输入需"输入监控"授权;rdev 可能须主线程/独立进程。
- **杀软告警**:低级输入钩子像键盘记录器,Windows Defender/SmartScreen 可能提示,自机放行即可。
- **Tauri v2 权限系统**:前端默认不能直接调原生 API,需在 capabilities 里显式授权(已配 `remote.json`);新手常见"为什么不工作"。

## 10. 待决问题

- **跨圈排名**:`ticks` 只表圈内进度(0–100);要比较"谁跑得最远"需带 `laps` 或上报累计总数。先定哪种?
- **外壳选房间**:叠加层窗口加载固定 URL,如何注入/切换 `roomId`(菜单输入?启动参数?默认私有房?)。
- **玩家名 / 身份**:`join` 的 `name` 从哪来(菜单设置?随机昵称?)。
- 最终指标:是否只用输入数,还是支持多指标切换。
- 防作弊:何时从客户端自报转为服务端权威。
- macOS 全局监听:进程内 vs 独立进程的最终选型。
- 产品命名:待定。
