// Phase 3 self-heal test over the wire. A node client builds authSim and advances it by
// the frame log; we then CORRUPT authSim (flip a grid cell) to simulate divergence. The
// server stamps a grid checksum into the frame every SAND_CHECKSUM_EVERY ticks; the client
// detects the mismatch, sends {resync}, gets a fresh snapshot, rebuilds authSim, and a
// later checksum matches again (recovered).
//   node server/heal.test.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { SandSim, W } = require("../sim.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "index.js");
const PORT = Number(process.env.SMOKE_PORT || 8094);
const ROOM = "H" + Date.now().toString(36).slice(-5);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sand-heal-"));
const ENV = { ...process.env, SAND_CHECKSUM_EVERY: "10", SAND_SAVE_MS: "60000", SAND_DATA_DIR: DATA_DIR, PORT: String(PORT) }; // checksum every 10 ticks (~0.5s) for a fast test

let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log((c ? "  ok  " : " FAIL ") + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s || "", "base64");

function startServer() {
  const child = spawn(process.execPath, [SERVER], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  const ready = new Promise((res) => { const on = (x) => { if (String(x).includes("authoritative server on")) { child.stdout.off("data", on); res(); } }; child.stdout.on("data", on); });
  child.stderr.on("data", (x) => process.stderr.write("[srv] " + x));
  return { child, ready };
}
function open(pk) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/r/${ROOM}?_pk=${pk}`);
  const o = { ws, ready: new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); }) };
  ws.addEventListener("message", (e) => o.onmsg && o.onmsg(JSON.parse(e.data)));
  return o;
}
const send = (o, m) => o.ws.send(JSON.stringify(m));
function applyFrameEvents(s, evs) {
  for (const ev of evs || []) {
    if (ev.op === "input") s.enqueue(ev.id, ev.delta);
    else if (ev.op === "join") s.addMember(ev.id, ev.color);
    else if (ev.op === "leave") s.removeMember(ev.id);
    else if (ev.op === "spout") s.setSpout(ev.id, ev.size);
    else if (ev.op === "pour") s.setPour(ev.id, ev.on);
    else if (ev.op === "flood") s.setFlood(ev.id, ev.on);
    else if (ev.op === "reset") s.reset();
  }
}
function buildAuthSim(msg) {
  const s = new SandSim({ H: msg.h, rngState: msg.rng >>> 0 });
  if (msg.grid) s.grid.set(b64(msg.grid).subarray(0, W * msg.h));
  s.bands = Array.isArray(msg.bands) ? msg.bands.map((b) => { const r = b.rows | 0; const c = new Uint8Array(r * W); c.set(b64(b.cells).subarray(0, r * W)); return { rows: r, n: b.n | 0, cells: c }; }) : [];
  s.frame = msg.frame | 0;
  if (msg.queues) s.queues = { ...msg.queues };
  if (msg.spout) s.spoutSize = { ...msg.spout };
  s.members = {};
  if (msg.players) for (const id in msg.players) s.addMember(id, msg.players[id].color);
  return s;
}

async function main() {
  const srv = startServer(); await srv.ready;
  const a = open("a"); await a.ready;

  let authSim = null, corrupted = false, healSnap = false;
  let diverged = false, resyncs = 0, healed = false;
  a.onmsg = (m) => {
    if (m.type === "snapshot") { authSim = buildAuthSim(m); if (corrupted) healSnap = true; } // rebuild = wipes corruption
    else if (m.type === "frame" && authSim) {
      applyFrameEvents(authSim, m.events); authSim.step(); authSim.maybeArchive();
      if (m.chk !== undefined) {
        const match = (authSim.checksum() >>> 0) === (m.chk >>> 0);
        if (!match) { diverged = true; resyncs++; send(a, { type: "resync" }); }
        else if (healSnap) healed = true; // a checksum matched AFTER the heal snapshot
      }
    }
  };
  send(a, { type: "join", name: "A", lockstep: true });
  await sleep(150);
  send(a, { type: "spout", size: 3 });
  send(a, { type: "input", ticks: 400 });   // pour so the grid evolves
  await sleep(900);                          // let authSim build + a few checksums match cleanly

  // CORRUPT authSim → it now disagrees with the server
  authSim.grid[0] = authSim.grid[0] ? 0 : 3;
  corrupted = true;

  for (let i = 0; i < 120 && !healed; i++) await sleep(50); // wait for detect → resync → heal

  ok(diverged, "client detected the divergence via the frame checksum");
  ok(resyncs >= 1, "client requested a resync (" + resyncs + ")");
  ok(healSnap, "server answered resync with a fresh snapshot (authSim rebuilt)");
  ok(healed, "a later checksum matched again — client self-healed");

  srv.child.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? "x" : "+"} ${pass} passed, ${fail} failed (room ${ROOM})`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("crashed:", e); process.exit(2); });
