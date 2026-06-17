# Project Bar — 设计与架构

> 这是**会演化**的完整方案:架构、数据流、技术选型理由、分阶段计划、关键代码参考。
> 跨会话必须守住的硬规则在 `CLAUDE.md`,本文件只补充细节与计划。
> 状态:原型阶段 · 主力平台 Windows · UI 已有(`index.html`)。

---

## 1. 产品愿景

一个透明、置顶的桌面"智能贴纸",把数字劳动数据变成**赛道竞速**的可视化:

- 同一房间的多个用户,根据共享指标(v1 = 键盘按键数)化身赛道上的赛车,实时竞速。
- 基调:轻松的派对游戏感。定位是**带吉祥物的工具**,不是游戏。
- 远期:小地图态 ↔ 展开面板态的双形态、赛道皮肤、自定义赛道形状。

## 2. 系统总览(三层)

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1 · Web UI (赛道)                                      │
│  纯 HTML/CSS/JS,GitHub Pages 托管,浏览器可独立运行           │
│  SVG <path> + getPointAtLength → 摆放赛车 + 排行榜            │
│  接收 keycount / 房间状态 → 渲染                               │
└───────────────▲───────────────────────────▲─────────────────┘
                │ Tauri 事件 'keycount'      │ WebSocket 房间状态
┌───────────────┴─────────────────┐  ┌──────┴─────────────────┐
│  Layer 2 · Tauri 外壳 (Rust)     │  │  Layer 3 · 后端         │
│  透明/无边框/置顶 原生窗口        │  │  原型:一台主机跑 WS 服务 │
│  加载 Pages URL                  │  │  汇总各客户端 count 并广播 │
│  全局键盘统计 (rdev)             │  │  日后 → PartyKit(云)    │
│  写本地文件持久化                 │  │                         │
└──────────────────────────────────┘  └─────────────────────────┘
```

- **Layer 1** 在任意设备(含 iPad)上通过 Pages 迭代,跨平台免费。
- **Layer 2** 在本地按系统构建,只负责"原生能力 + 装载 UI"。
- **Layer 3** 原型用局域网主机,逻辑可整体替换为云服务。

## 3. 数据模型与流转

**单机闭环(v1):**

```
你打字 → Rust 全局监听数到 KeyPress → 累加 count
       → emit('keycount', count) 给 webview
       → webview: along = (count % PER_LAP)/PER_LAP * L
                  pt = path.getPointAtLength(along) → 移动赛车
       → 每 N 次写入本地文件(app_data_dir/keycount.txt)
```

**多人房间状态(v1 原型):**

```json
{ "racers": [ { "name": "You", "count": 1234 }, { "name": "Mara", "count": 980 } ] }
```

每个客户端把自己的 `count` 上报主机;主机合并后广播完整 `racers`;各端按各自 count 渲染所有赛车(复用单机的 path 映射逻辑,dist 换成各人的 count)。

## 4. 指标(metric)

- **v1 = 键盘按键数**。设计上让"指标来源可替换"——日后可换成专注时长 / 提交数 / 步数等,渲染层不变。
- 原型为**客户端自报**;**防作弊不在原型范围内**(日后若需要,改为服务端取数或权威校验,见 §8)。

## 5. 技术选型与理由

- **为什么 Web/Tauri 而非 Unity/Godot**:产品主体是 UI(赛道 + 面板),Web 做 UI 最快;透明叠加 + 全局输入在任何路线都要按系统接原生,Web/Tauri 的原生适配面最小、最轻。引擎留给"游戏化内容显著变重"的产品化阶段再议。
- **为什么 `rdev`**:跨平台全局键盘监听,能逐次捕获 KeyPress 用于计数。
- **为什么 `ws` → PartyKit**:原型用几十行 Node WS 即可验证"主机汇总"模型;云化时 PartyKit 的"每房间一个边缘实例"与本模型 1:1 对应,迁移成本低。

## 6. 跨平台计划

| 层 | Windows(现在) | macOS(以后) |
|---|---|---|
| Web UI | 免费一致 | 免费一致 |
| 透明置顶 | `transparent:true` 即可 | 需 `macOSPrivateApi:true`(+ App Store 限制) |
| 全局统计 | 免授权直接跑 | 需"输入监控"授权;rdev 可能需独立进程 |
| 打包 | 本机构建 .exe/.msi | **必须在 Mac 上**构建 .app/.dmg(Tauri 不跨编译) |

一套源码,按系统各构建一次;UI 共用同一个 Pages 地址。

## 7. 分阶段计划

### 阶段 A · 透明置顶外壳(对应需求 1)
- `npm create tauri-app@latest`(Vanilla)→ 配置窗口加载 Pages URL → `npm run tauri dev`。
- 页面加 `html,body{background:transparent!important}`。
- **DoD**:桌面浮出透明置顶赛道。

`src-tauri/tauri.conf.json` 的 `app.windows`(Windows 版):
```json
"windows": [{
  "label": "main",
  "url": "https://faylee studio.github.io/Project-Bar/",
  "width": 360, "height": 360,
  "transparent": true, "decorations": false,
  "alwaysOnTop": true, "shadow": false, "skipTaskbar": true
}]
```
> 注意把 url 改成真实 Pages 地址(用户名/仓库名,无空格)。macOS 构建时在 `app` 段加 `"macOSPrivateApi": true`。

### 阶段 B · 全局打字统计 + 写文件(对应需求 2)← 当前重点
- `Cargo.toml` 加 `rdev = "0.5"`。
- Rust 在独立 OS 线程跑全局监听,数 KeyPress、emit、落盘。
- 前端 `listen('keycount')` 驱动赛车。
- **DoD**:任意处打字 → 本机赛车前进;count 持久化到 `keycount.txt`。

`src-tauri/src/lib.rs` 的 `run()`:
```rust
use std::sync::{Arc, atomic::{AtomicU64, Ordering}};
use std::fs;
use tauri::{Emitter, Manager, DeviceEventFilter};
use rdev::{listen, EventType};

pub fn run() {
  tauri::Builder::default()
    .device_event_filter(DeviceEventFilter::Never)   // 缓解焦点夺键问题,见 §8
    .setup(|app| {
      let handle = app.handle().clone();
      let dir = handle.path().app_data_dir().unwrap();
      fs::create_dir_all(&dir).ok();
      let file = dir.join("keycount.txt");

      let start: u64 = fs::read_to_string(&file).ok()
        .and_then(|s| s.trim().parse().ok()).unwrap_or(0);
      let counter = Arc::new(AtomicU64::new(start));
      handle.emit("keycount", start).ok();

      let (c, h, f) = (counter.clone(), handle.clone(), file.clone());
      std::thread::spawn(move || {
        let _ = listen(move |e| {
          if let EventType::KeyPress(_) = e.event_type {   // 只数次数,不记是哪个键
            let n = c.fetch_add(1, Ordering::Relaxed) + 1;
            h.emit("keycount", n).ok();
            if n % 25 == 0 { let _ = fs::write(&f, n.to_string()); }
          }
        });
      });
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri");
}
```

前端(赛道页):
```js
import { listen } from '@tauri-apps/api/event';
const PER_LAP = 500;                       // 500 次打字 = 一圈,可调
const L = path.getTotalLength();
listen('keycount', (e) => {
  const along = (e.payload % PER_LAP) / PER_LAP * L;
  const pt = path.getPointAtLength(along);
  myRacer.setAttribute('transform', `translate(${pt.x},${pt.y})`);
});
```
> 若前端收不到事件,在 `src-tauri/capabilities/default.json` 的 permissions 加 `core:event:default`。

### 阶段 C · 主机即服务器,汇总房间数据(对应需求 3)
- 主机跑 Node WS 服务;客户端上报 `{name,count}`;主机广播全房间状态。
- **先用两个浏览器标签连 `ws://localhost:8787` 验证逻辑**(纯 Web,不碰 Tauri),再让别的设备连主机局域网 IP(同 WiFi、放行端口)。
- **DoD**:多端在同一房间看到彼此的赛车按各自打字数前进。

`server/server.js`:
```js
import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ port: 8787 });
const room = new Map();                       // id -> {name, count}
wss.on('connection', (ws) => {
  const id = crypto.randomUUID();
  ws.on('message', (m) => {
    const { name, count } = JSON.parse(m);
    room.set(id, { name, count });
    const state = JSON.stringify({ racers: [...room.values()] });
    wss.clients.forEach(c => c.readyState === 1 && c.send(state));
  });
  ws.on('close', () => room.delete(id));
});
```

### 阶段 D · 产品化(以后)
双形态(小地图 ↔ 面板)、逐像素鼠标穿透(命中检测)、贴边吸附、PartyKit 云后端、赛道皮肤 / 自定义赛道、可选账号与持久化排行榜。

## 8. 已知问题与风险

- **rdev 焦点夺键(Tauri issue #14770,2026 仍在)**:rdev 装在 Tauri 进程内时,当 Tauri 窗口自身获得焦点会收不到键盘事件(鼠标正常)。缓解:`device_event_filter(Never)`;桌宠通常不抢焦点故影响小;终极方案是把监听拆成独立小进程。
- **macOS**:透明需私有 API(上架受限);全局输入需"输入监控"授权;rdev 可能须主线程/独立进程。
- **杀软告警**:低级键盘钩子像键盘记录器,Windows Defender/SmartScreen 可能提示,自机放行即可。
- **Tauri v2 权限系统**:前端默认不能直接调原生 API,需在 capabilities 里显式授权(如 `core:window:allow-set-ignore-cursor-events`、`core:window:allow-start-dragging`),新手常见"为什么不工作"。

## 9. 待决问题

- 最终指标:是否只用打字数,还是支持多指标切换。
- 防作弊:何时从客户端自报转为服务端权威。
- macOS 全局监听:进程内 vs 独立进程的最终选型。
- 产品命名:待定。