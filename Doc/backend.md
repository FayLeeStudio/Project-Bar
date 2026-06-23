# Sand Together — 后端规范（服务端权威）

> 2026-06-21 架构转向后的后端：**常驻 Node + ws 服务，跑权威物理**。
> 旧的 Cloudflare Workers + DO 版本已作废（见 git 历史 / `party/`）。
> 架构背景见 `architecture.md`、`CLAUDE.md`。

---

## 职责

后端是一个**常驻、有状态**的进程。对每个房间：

1. 跑 falling-sand 物理模拟（权威），持有该房间唯一的 `grid`（= 房间真相）
2. 收客户端输入（累计击键数 `ticks`），换算成出沙
3. 把 `grid` 的**增量变化**广播给同房间所有客户端
4. 把 `grid` + 玩家档案**持久化到磁盘**（存档），重启 / 新人加入时恢复 / 下发

客户端**不跑物理**：只发输入、收状态、纯渲染。隐私红线：只处理计数 + 网格像素，**绝不**键位内容。

---

## 路由

```text
ws://<host>/r/<roomId>?_pk=<playerId>
```

- 每个 `roomId` 对应一个内存中的 `Room`（含 grid + 模拟循环）。
- `_pk` = 客户端**持久** playerId（存 localStorage 复用），用于认出"老玩家回来了" vs "新玩家"。
- 默认端口 `8090`（`PORT` 环境变量可改）。生产经 Caddy 反代为 `wss://<domain>`。

---

## 消息协议

### 客户端 → 服务端

```ts
{ type:"join",  name:"Fay", color:"auto" }  // 加入；color 由服务端分配
{ type:"input", ticks: 1234 }               // 累计击键数（服务端算增量 → 出沙）
{ type:"leave" }                            // 显式退出（释放颜色名额）
{ type:"reset" }                            // 清空本房间画布（原型：任何人可）
```

### 服务端 → 客户端

```ts
// 加入时：完整状态
{ type:"snapshot", w:80, h:200,
  players:{ "<id>":{ name, color, ticks }, ... },
  grid:"<base64 of W*H bytes>" }

// 每 tick：变化的网格单元（扁平 [格子下标, 新值, 格子下标, 新值, ...]）
{ type:"patch", c:[ idx0,val0, idx1,val1, ... ] }

// 玩家名册变化（join / leave）
{ type:"players", players:{ "<id>":{ name, color, ticks }, ... } }

// 房间已满（第 5 个新玩家）
{ type:"error", reason:"room_full" }
```

- 格子值：`0`=空，`1..4`=玩家槽位（颜色）。`idx = row*W + col`。
- 增量优先：高频 tick 只发变化单元；`snapshot` 仅在加入时发一次。

---

## 服务端状态结构（`server/index.js`）

每个 `Room`：

```text
grid    : Uint8Array(W*H)   // 唯一真相
prev    : Uint8Array(W*H)   // 上一帧广播态，用于 diff 出 patch
players : { playerId: { name, color, ticks } }   // 持久（断线不删）
queues  : { playerId: 待出沙粒数 }
conns   : Map<ws, playerId>
```

- 进程重启 / 房间首次激活 → 从 `server/data/<roomId>.json` 读回 `players` + `grid`。
- 断线（close）：只移除连接，**保留玩家**（离线 ≠ 退出）；房间空闲时停模拟循环省 CPU，grid 留在内存 + 磁盘。
- 显式 `leave` 才删玩家、释放颜色。

---

## 模拟 / 渲染参数（服务端权威，客户端渲染共享同一约定）

| 参数 | 值 | 说明 |
|---|---|---|
| 网格 `W × H` | 80 × 200 | 服务端持有；客户端显示其中一个窗口（viewRows=170） |
| 颜色槽位 | amber/teal/violet/rose = 1/2/3/4 | `color 名 → grid 值`，全局一致 |
| 出口 `SPOUT_X` | {1:30,2:50,3:10,4:70} | 按槽位、沿 `W=80` 均匀分布（中心向外）；出口随堆顶上移（`surface - SPAWN_GAP`） |
| `SPAWN_GAP` | 92 | 出沙口在堆顶上方这么多行；与客户端 0.618 镜头锚点配套，使水龙头落在视口顶部附近 |
| 物理帧率 | 20fps（`TICK_MS=50`） | 每 tick：spawn → 重力×2 子步 → diff → 广播 patch（2 子步让下落更顺） |
| `MAX_SPAWN_PER_TICK` | 4 / 玩家 | 限速，避免狂打字一帧倒满 |
| 房间容量 | 4 人 | 第 5 个新玩家 → `room_full` |
| 存盘间隔 | 5s（`SAVE_MS`） | dirty 才写 |

物理算法（逐行自底向上，重力 + 随机左右下滑，扫描方向逐帧交替）沿用旧客户端引擎，现在跑在服务端、对所有人是同一份。

---

## 持久化

- 每房间一个文件 `server/data/<roomId>.json`：`{ players, grid:<base64> }`（gitignored）。
- 写：dirty 时每 5s 一次 + 房间空闲停机前。读：房间首次激活时。
- 服务端就是存档的唯一真相；新玩家加入直接收 `snapshot`，不重放。

---

## 部署（海外 VPS + Caddy）

一键脚本 `server/deploy.sh`，反代配置 `server/Caddyfile`。流程：

1. 海外节点 VPS（腾讯云 / 阿里云 香港或新加坡轻量，2C2G）；域名一条 A 记录指向它（如 `titb.indiegames.design`）。
2. 把仓库弄上去：`git clone <repo>`（推荐，脚本经 `.gitattributes` 保 LF）**或** `scp` 整个仓库；`npm install --omit=dev`。
3. `sudo server/deploy.sh <domain>`：装 Node、配 systemd（常驻 + 崩溃重启）、装 Caddy（自动 Let's Encrypt 证书 + 反代 `443 → 127.0.0.1:8090`，WebSocket 透传）。
4. 云控制台安全组放行 `443`（+ `22`）。
5. 客户端 `index.html` 的 `PROD_HOST` 改为该域名（`wss`），再 push 到 Pages。

> ⚠️ **部署顺序**：先让 VPS 跑起来、本地用 `?host=<domain>` 验证 `wss` 通，**再**改 `PROD_HOST` 并 push 前端。否则线上 Pages 会指向一个还不存在的后端（空瓶 / 连不上）。

本地开发：`npm run server`（localhost:8090），`index.html` 从 `file://` / localhost 自动连本地。

---

## 待决

- **带宽优化**：`patch` 现为全 grid diff；高频多人时可进一步压（RLE / 只发活跃前沿）。
- **防作弊**：`input` 信任客户端自报计数（原型）；后期可服务端校验速率。
- **无限累积**：`grid` 满（H 行）即停止增长；底部压缩 / 滚动（沉降展示）留 Stage 3。
- **多房间扩展**：单进程多房间；规模大需多进程 / 多机 + 房间路由。
