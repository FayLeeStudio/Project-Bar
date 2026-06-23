// Patch-bandwidth probe (measurement, not a test). Spawns a PRODUCTION-size room
// (no grid env overrides → W=80, H=300), has 4 players flood input, and records
// what the server actually broadcasts each second: patches/sec, avg + peak patch
// bytes (the JSON wire size), avg + peak changed cells, and total KB/s. This tells
// us whether the client "卡" is dominated by patch bandwidth / JSON.parse cost
// (→ binary patches / active-front) vs. input latency (→ prediction).
//   node server/perf-probe.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "index.js");
const PORT = Number(process.env.PROBE_PORT || 8096);
const ROOM = "PERF" + Date.now().toString(36).slice(-4);
const PLAYERS = Number(process.env.PROBE_PLAYERS || 4);
const SECS = Number(process.env.PROBE_SECS || 15);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sand-perf-"));
const ENV = { ...process.env, PORT: String(PORT), SAND_DATA_DIR: DATA_DIR }; // production sim sizes

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const child = spawn(process.execPath, [SERVER], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  const ready = new Promise((res) => {
    const onData = (b) => { if (String(b).includes("authoritative server on")) { child.stdout.off("data", onData); res(); } };
    child.stdout.on("data", onData);
  });
  child.stderr.on("data", (b) => process.stderr.write("[srv] " + b));
  return { child, ready };
}

function open(pk, record) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/r/${ROOM}?_pk=${pk}`);
  ws.addEventListener("message", (e) => {
    if (!record) return;
    const bytes = typeof e.data === "string" ? e.data.length : e.data.byteLength;
    let d; try { d = JSON.parse(e.data); } catch (_) { return; }
    if (d.type === "patch") record(bytes, d.c ? d.c.length / 2 : 0);
  });
  return Object.assign(ws, { ready: new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); }) });
}
const join = (ws, name) => ws.send(JSON.stringify({ type: "join", name, color: "auto" }));
function flood(ws) {
  let t = 0;
  const iv = setInterval(() => { if (ws.readyState === 1) { t += 1000; ws.send(JSON.stringify({ type: "input", ticks: t })); } }, 150);
  return () => clearInterval(iv);
}

// per-second bucket
let sec = { patches: 0, bytes: 0, cells: 0, peakBytes: 0, peakCells: 0 };
const reset = () => (sec = { patches: 0, bytes: 0, cells: 0, peakBytes: 0, peakCells: 0 });
function record(bytes, cells) {
  sec.patches++; sec.bytes += bytes; sec.cells += cells;
  if (bytes > sec.peakBytes) sec.peakBytes = bytes;
  if (cells > sec.peakCells) sec.peakCells = cells;
}

const main = async () => {
  const srv = startServer();
  await srv.ready;
  const observer = open("obs", record); await observer.ready; join(observer, "OBS");
  const players = [];
  for (let i = 1; i < PLAYERS; i++) { const p = open("p" + i, null); await p.ready; join(p, "P" + i); players.push(p); }
  // observer also pours so all 4 slots are active
  const stops = [flood(observer), ...players.map(flood)];

  console.log(`probe: W=80 H=300, ${PLAYERS} players flooding, room ${ROOM}\n` +
    `  t  patch/s   avgB   peakB   avgCells  peakCells   KB/s`);
  let agg = { patches: 0, bytes: 0, cells: 0, peakBytes: 0, peakCells: 0 };
  for (let s = 1; s <= SECS; s++) {
    await sleep(1000);
    const avgB = sec.patches ? (sec.bytes / sec.patches) : 0;
    const avgC = sec.patches ? (sec.cells / sec.patches) : 0;
    console.log(
      `${String(s).padStart(3)} ${String(sec.patches).padStart(7)} ${avgB.toFixed(0).padStart(6)} ` +
      `${String(sec.peakBytes).padStart(7)} ${avgC.toFixed(0).padStart(9)} ${String(sec.peakCells).padStart(10)} ` +
      `${(sec.bytes / 1024).toFixed(1).padStart(7)}`);
    agg.patches += sec.patches; agg.bytes += sec.bytes; agg.cells += sec.cells;
    agg.peakBytes = Math.max(agg.peakBytes, sec.peakBytes); agg.peakCells = Math.max(agg.peakCells, sec.peakCells);
    reset();
  }
  stops.forEach((s) => s());
  console.log(`\nover ${SECS}s: ${agg.patches} patches, ${(agg.bytes / 1024).toFixed(0)} KB total, ` +
    `${(agg.bytes / 1024 / SECS).toFixed(1)} KB/s avg, peak patch ${agg.peakBytes} B / ${agg.peakCells} cells`);
  srv.child.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(0);
};
main().catch((e) => { console.error("crashed:", e); process.exit(2); });
