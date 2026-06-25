// Phase 3 patch-routing test: with frames on, `patch`/`band` go ONLY to non-lockstep
// clients. A joins announcing lockstep:true → gets `frame`s, ZERO `patch`. B joins
// announcing lockstep:false (an old/forced-patch client) → gets `patch`es. This is the
// bandwidth win (lockstep clients no longer download per-cell patches they'd ignore).
//   node server/patch-route.test.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "index.js");
const PORT = Number(process.env.SMOKE_PORT || 8093);
const ROOM = "P" + Date.now().toString(36).slice(-5);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sand-route-"));
const ENV = { ...process.env, SAND_SAVE_MS: "60000", SAND_DATA_DIR: DATA_DIR, PORT: String(PORT) }; // frames ON by default

let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log((c ? "  ok  " : " FAIL ") + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const child = spawn(process.execPath, [SERVER], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  const ready = new Promise((res) => { const on = (x) => { if (String(x).includes("authoritative server on")) { child.stdout.off("data", on); res(); } }; child.stdout.on("data", on); });
  child.stderr.on("data", (x) => process.stderr.write("[srv] " + x));
  return { child, ready };
}
function open(pk) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/r/${ROOM}?_pk=${pk}`);
  const c = { frame: 0, patch: 0, band: 0, snapshot: 0 };
  const o = { ws, c, ready: new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); }) };
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (c[m.type] !== undefined) c[m.type]++; });
  return o;
}
const send = (o, m) => o.ws.send(JSON.stringify(m));

async function main() {
  const srv = startServer(); await srv.ready;

  const a = open("a"); await a.ready; send(a, { type: "join", name: "A", lockstep: true });  // lockstep client
  const b = open("b"); await b.ready; send(b, { type: "join", name: "B", lockstep: false }); // old / forced-patch client
  await sleep(200);
  send(a, { type: "spout", size: 3 });
  send(a, { type: "input", ticks: 500 }); // pour → grid changes every tick
  await sleep(1500);

  ok(a.c.frame > 0, "lockstep client A receives frames (" + a.c.frame + ")");
  ok(a.c.patch === 0 && a.c.band === 0, "lockstep client A receives ZERO patch/band (" + a.c.patch + "/" + a.c.band + ")");
  ok(b.c.patch > 0, "non-lockstep client B receives patches (" + b.c.patch + ")");

  srv.child.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? "x" : "+"} ${pass} passed, ${fail} failed (room ${ROOM})`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("crashed:", e); process.exit(2); });
