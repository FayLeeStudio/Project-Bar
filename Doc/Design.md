# Project Bar — 设计与架构

> 这是**会演化**的完整方案:架构、数据流、技术选型理由、分阶段计划、关键代码参考。
> 跨会话必须守住的硬规则在 `CLAUDE.md`,本文件只补充细节与计划。
> 状态:**Stage 1(单机)已完成** · **Stage 2(多人 / Cloudflare Workers + Durable Objects)进行中** · 主力平台 Windows。
> 后端历史:原定 PartyKit,因其共享域名 `partykit.dev` 撞 Cloudflare 子域名上限、免费托管无法新部署,改用其底层 CF Workers + DO 直连(详见 §5 / §8)。

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
│  接收 keycount(本机) / 房间状态(后端) → 渲染                │
└───────────────▲───────────────────────────▲─────────────────┘
                │ Tauri 事件 'keycount'      │ WebSocket(wss) 房间状态
┌───────────────┴─────────────────┐  ┌──────┴──────────────────┐
│  Layer 2 · Tauri 外壳 (Rust)     │  │  Layer 3 · 后端 CF Workers│
│  透明/无边框/置顶 原生窗口        │  │  每房间一个 Durable Object│
│  加载 Pages URL                  │  │  收某玩家 ticks → 广播    │
│  全局输入统计 (rdev)             │  │  全房间 state            │
│  写本地文件持久化                 │  │  (云;本地 wrangler dev)   │
└──────────────────────────────────┘  └──────────────────────────┘
```

- **Layer 1** 在任意设备(含 iPad)上通过 Pages 迭代,跨平台免费。
- **Layer 2** 在本地按系统构建,只负责"原生能力 + 装载 UI"。
- **Layer 3** = Cloudflare Workers + Durable Objects:每个 `roomId` 对应一个 DO 实例,只转发整数,不感知赛道。

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

**多人房间(Stage 2,Cloudflare Workers + DO):**

```
本机 count → 前端节流(10fps)→ ws.send({type:'progress', ticks})
          → 房间 DO 合并 → 广播 {type:'state', players:{id:{name,ticks}}}
          → 各端对每个玩家:pt = getPointAtLength((ticks/100) * L) → 摆位
```

每个客户端只上报**自己的** ticks;房间 DO 合并后广播完整 `players`;各端复用单机的 path 映射逻辑渲染所有赛车。详见 §8 后端规范。

## 4. 指标(metric)

- **v1 = 键盘按键 + 鼠标点击数**(rdev 的 `KeyPress` + `ButtonPress`;不含移动/滚轮/释放)。
- 设计上让"指标来源可替换"——日后可换成专注时长 / 提交数 / 步数等,渲染层不变。
- 原型为**客户端自报**;**防作弊不在原型范围内**(日后若需要,改服务端权威校验,见 §10)。

## 5. 技术选型与理由

- **为什么 Web/Tauri 而非 Unity/Godot**:产品主体是 UI(赛道 + 面板),Web 做 UI 最快;透明叠加 + 全局输入在任何路线都要按系统接原生,Web/Tauri 的原生适配面最小、最轻。引擎留给"游戏化内容显著变重"的产品化阶段再议。
- **为什么 `rdev`**:跨平台全局输入监听,能逐次捕获 KeyPress/ButtonPress 用于计数。
- **为什么 Cloudflare Workers + Durable Objects(直接上云,跳过局域网主机原型)**:
  - "每房间一个 Durable Object 实例"与本产品的"房间"模型 1:1 对应,服务端只有几十行。
  - **本地开发无摩擦**:`npx wrangler dev` 起 localhost 实例(workerd/miniflare),两个浏览器标签即可联调;验证完 `wrangler deploy` 上 `*.workers.dev`,免费、免自有域名。
  - 省掉了局域网主机方案的痛点(找主机 IP、同一 WiFi、放行端口、主机下线房间就没了)。
  - **为什么不是 PartyKit**(原计划):PartyKit 是 CF DO 的便利包装,但其共享托管域名 `partykit.dev` 撞到 Cloudflare「单域名最多 10000 个自定义子域名」上限,2026-06 起免费新部署全部失败;直接用其底层 CF DO 即绕开此限制,技术栈等价。

## 6. 跨平台计划

| 层 | Windows(现在) | macOS(以后) |
|---|---|---|
| Web UI | 免费一致 | 免费一致 |
| 透明置顶 | `transparent:true` 即可 | 需 `macOSPrivateApi:true`(+ 上架限制) |
| 全局统计 | 免授权直接跑 | 需"输入监控"授权;rdev 可能需独立进程 |
| 打包 | 本机构建 .exe/.msi | **必须在 Mac 上**构建 .app/.dmg(Tauri 不跨编译) |
| 后端 | Cloudflare Workers + DO 云,与系统无关 | 同左 |

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

### 阶段 C · 多人房间(Cloudflare Workers + DO)← 当前重点
- ✅ `party/server.ts`(Worker + DO)+ `wrangler.toml` 已写;前端 WS 客户端已接(join / 100ms 节流上报 / 渲染全房间赛车)。
- ✅ 后端协议已用 `party/smoke-test.mjs` 对 `wrangler dev` 端到端验证(join→progress→广播→离场),并验证房间隔离(不同房间号 = 独立 DO,互不可见)。
- ✅ 房间 UX:4 位易读房间码,菜单「新建/加入/复制链接」,localStorage 持久化,切房间不刷新直接重连;Tauri 外壳无需注入 roomId(§10 已定)。
- ⏳ **待办**:① `npx wrangler login` + `npm run party:deploy` 上云,把前端 `PROD_HOST` 的 `CF_SUBDOMAIN` 占位换成真实 workers.dev 子域名;
  ② 两个浏览器标签开同一 `?room=XXXX&sim` 目视确认赛车互相可见(纯 Web,不碰 Tauri);
  ③ 推 index.html 到 Pages,真·异地联机。
- **本地联调**:`npm run party:dev` 起 127.0.0.1:8787(wrangler dev);前端在 `file://` / `localhost` / `127.0.0.1` 下自动连本地(`projectbar.partyhost` 可覆盖)。
- **DoD**:多端在同一房间看到彼此的赛车按各自输入数前进。
- 完整规范见 §8。

### 阶段 D · 产品化(以后)
双形态(小地图 ↔ 面板)、逐像素鼠标穿透(命中检测)、贴边吸附、赛道皮肤 / 自定义赛道、可选账号与持久化排行榜、防作弊。

---

## 8. 后端规范(Cloudflare Workers + Durable Objects · Stage 2)

### 架构

```
[GitHub Pages UI]  ←→  WebSocket(wss)  ←→  [Worker] → [Durable Object: 一个房间]
                                            /parties/main/{roomId}?_pk={connId}
```

Worker 按 `roomId` 把连接路由到对应的 Durable Object(`idFromName(roomId)`)。
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

一个 Worker(按 `roomId` 路由到 DO)+ 一个 Durable Object `RaceRoom`(内存持有 `players`,每次变更重广播)。逻辑与原 PartyKit 版等价 —— "收 ticks → 广播 players",不感知赛道/圈长。完整代码见仓库 `party/server.ts`,要点:

```ts
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/parties\/main\/([^/]+)/);
    if (request.headers.get("Upgrade") === "websocket" && m) {
      const stub = env.RACEROOM.get(env.RACEROOM.idFromName(decodeURIComponent(m[1])));
      return stub.fetch(request);                 // 路由到该房间的 DO
    }
    return new Response("Project Bar room server");
  },
};

export class RaceRoom {                            // 一个 roomId = 一个实例
  players = {};                                    // connId -> { name, ticks }
  conns = new Map();                               // WebSocket -> connId

  async fetch(request) {
    const connId = new URL(request.url).searchParams.get("_pk") || crypto.randomUUID();
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    this.conns.set(server, connId);
    server.send(JSON.stringify({ type: "state", players: this.players }));   // 入场快照
    server.addEventListener("message", (e) => this.onMessage(connId, e.data));
    const drop = () => this.onClose(server, connId);
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);
    return new Response(null, { status: 101, webSocket: client });
  }
  // onMessage: join → 建档;progress → 更新整数 ticks;坏/未知消息忽略;然后 broadcast()
  // onClose:   从 conns/players 移除并 broadcast()
  // broadcast: 向 conns 里所有 socket 发 { type:"state", players }
}
```

> **回归测试**:`node party/smoke-test.mjs`(需先 `npm run party:dev` = `wrangler dev`)模拟两名玩家,断言 join/progress/广播/离场都正确,并验证 `?_pk` 把连接 ID 设成我们指定的值;另测了不同房间号映射到独立 DO(互不可见)。

### 配置文件(`wrangler.toml`)

```toml
name = "project-bar"
main = "party/server.ts"
compatibility_date = "2026-06-18"

[[durable_objects.bindings]]
name = "RACEROOM"
class_name = "RaceRoom"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RaceRoom"]   # SQLite 版 DO = 免费套餐可用
```

### 前端接入要点(已实现于 `index.html`)

关键设计决定:

- **自带连接 ID**:用 `?_pk=<随机 id>` 连接,Worker 把它读成该连接的 id,于是前端**知道自己的 id**,在渲染广播时跳过自己的车 —— 服务端无需为此改动。
- **本地车零延迟**:自己的车仍由 Stage B 的 `keycount` 即时驱动(`#car`);只有**别人的**车从广播 `state` 渲染(`#remoteCars` 里每人一个 `<g>`,带颜色+昵称)。
- **ticks 与 PER_LAP 解耦**:上报 `Math.round(progress)`(圈内进度 0–100),后端/他端都不需要知道本地一圈多少次输入。渲染照旧只用 `getPointAtLength`。
- **优雅退回单机**:只有"打算联机"(有 `?room=` / 本地 dev / 配了 host / 填了真实用户名)才连;连不上时静默,不破坏 Stage 1。
- **主机解析**:`file://` / `localhost` / `127.0.0.1` → `ws://127.0.0.1:8787`(`wrangler dev`);否则 `wss://<PROD_HOST>`。`PROD_HOST` 里的 `CF_SUBDOMAIN` 需换成 `wrangler deploy` 后拿到的 workers.dev 子域名;`localStorage['projectbar.partyhost']` 可运行时覆盖。
- **昵称**:`localStorage['projectbar.name']`,默认 `玩家-<id前4>`,菜单"🏷 改昵称"可改(改后自动重连重新 join)。
- **房间创建/加入**:房间号 4 位易读码,存 `localStorage['projectbar.room']`;菜单「新建房间 / 加入房间(输码)/ 复制链接」,切房间不刷新页面直接重连。`switchRoom()` 会清掉旧房间残留的远端车再重连。
- **`?sim` 调试驱动(仅浏览器测试)**:浏览器里没有 Rust `keycount`,加 `?sim` 后页面自身焦点内的按键/点击给本地计数 +1,驱动自己的车 —— 纯测试桩,不进生产输入路径,有 Tauri 外壳时自动禁用。两个标签开 `?room=TEST&sim` 即可看车互相竞速。

```js
const roomId = new URLSearchParams(location.search).get("room")
            || Math.random().toString(36).slice(2, 8);
const myId = crypto.randomUUID();
const ws = new WebSocket(
  `${wsProto}://${PARTY_HOST}/parties/main/${roomId}?_pk=${myId}`
);
ws.onopen = () => ws.send(JSON.stringify({ type: "join", name: playerName }));
ws.onmessage = ({ data }) => {
  const { type, players } = JSON.parse(data);
  if (type !== "state") return;
  for (const id in players) {
    if (id === myId) continue;                 // 自己的车本地即时驱动
    const { ticks } = players[id];
    const pt = path.getPointAtLength((ticks / 100) * path.getTotalLength());
    // 用 pt.x / pt.y 定位 / 创建该玩家的赛车元素
  }
};
```

### 部署

> **关于后端地址**:`wrangler deploy` 把后端部署到 `project-bar.<你的 workers.dev 子域名>.workers.dev`。该子域名是**开发者账号**首次部署时一次性选定/分配,在 `index.html` 的 `PROD_HOST` 里写死一次即可,**玩家永不接触**(玩家之间只用房间号区分)。本地 `wrangler dev` 阶段完全不需要账号。

```bash
# 本地联调（推荐先做，无需账号）：起 localhost(workerd/miniflare)
npm run party:dev    # = npx wrangler dev，监听 127.0.0.1:8787
# 浏览器开两个标签：…/index.html?room=TEST&sim（?sim 用来在浏览器里驱动赛车）

# 上云（让不同机器/真人联机）：免费注册 Cloudflare + 部署
npx wrangler login   # 浏览器授权 CLI(已登录网页后台时一键确认)
npm run party:deploy # = npx wrangler deploy → 打印 project-bar.<子域名>.workers.dev
# 然后把该地址填进 index.html 的 PROD_HOST（替换占位符 CF_SUBDOMAIN）
```

### 房间分享

```
https://indiegames.design/Project-Bar/?room=ABCD
# Tauri 叠加层窗口需保留 #overlay：?room=ABCD#overlay
# （fayleestudio.github.io/Project-Bar/ 会 301 跳到自定义域名，等价）
```

---

## 9. 已知问题与风险

- **rdev 焦点夺键(Tauri #14770,2026 仍在)**:rdev 在 Tauri 进程内时,Tauri 窗口自身获得焦点会收不到键盘事件(鼠标正常)。缓解:`device_event_filter(Never)`;桌宠通常不抢焦点故影响小;终极方案是把监听拆成独立小进程。
- **后端远程访问**:Pages(https)连 Cloudflare Workers 必须用 `wss://`;Tauri 远程页面发起 WS 连接通常无需额外 capability(WebSocket 是标准 Web API),但需确认 CSP 不拦截。
- **Durable Objects 免费套餐**:DO 须用 SQLite 版(`new_sqlite_classes`)才在 Workers Free 计划可用;若账号无法部署 DO,部署会报错,需检查计划。
- **中国大陆可达性(已实测,2026-06)**:`*.workers.dev`(及 Cloudflare 多数边缘)在大陆常被墙/限速,**不挂 VPN 同步不了**;挂 VPN 后异地联机正常。原型阶段可接受 VPN;若要面向大陆免 VPN 分发,Cloudflare 自有域名只是便宜一搏(免费 anycast 常同样被墙),可靠路线是改用**海外 VPS(香港/日本/新加坡)跑同一套 ~40 行 ws 房间服务 + 非 Cloudflare 域名**。把"大陆免 VPN 可达"当成显式验收项,别假设能通。
- **macOS**:透明需私有 API(上架受限);全局输入需"输入监控"授权;rdev 可能须主线程/独立进程。
- **杀软告警**:低级输入钩子像键盘记录器,Windows Defender/SmartScreen 可能提示,自机放行即可。
- **Tauri v2 权限系统**:前端默认不能直接调原生 API,需在 capabilities 里显式授权(已配 `remote.json`);新手常见"为什么不工作"。

## 10. 待决问题

**Stage 2 已定(本次实现):**

- ~~**玩家名 / 身份**~~ → `localStorage['projectbar.name']`,默认随机昵称 `玩家-<id前4>`,菜单可改;连接身份用前端生成的 `?_pk` id。
- ~~**房间来源 / 创建 / 加入**~~ → 房间号 = 4 位易读码(去掉 I L O 0 1)。解析优先级 `?room=` 链接 → `localStorage['projectbar.room']` → 随机新建,存回 localStorage。菜单有「✨ 新建房间 / 🚪 加入房间…(输码)/ 🔗 复制房间链接」,信息栏显示 `#XXXX`。加入靠**输确切房间号**(无目录可浏览,像 Jackbox/Among-Us 房号)。
- ~~**外壳选房间**~~ → **不需原生注入**:房间号在网页层用 localStorage 管理、菜单切换,外壳只加载固定 URL,浏览器/外壳一致(契约:UI 逻辑在网页)。切房间不刷新、直接重连。

**仍待决:**

- **跨圈排名**:`ticks` 只表圈内进度(0–100),目前他端车只显示圈内位置、不比较圈数。要做排行榜/"谁跑得最远"需另带 `laps` 或上报累计总数 —— 先定哪种再动后端协议。
- 最终指标:是否只用输入数,还是支持多指标切换。
- 防作弊:何时从客户端自报转为服务端权威。
- macOS 全局监听:进程内 vs 独立进程的最终选型。
- 产品命名:待定。
