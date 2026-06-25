// Lockstep frame-replay test — proves the server's per-tick `frame` event log fully
// determines the grid: replay the captured frames into a fresh SandSim and assert the
// per-tick checksum trail matches the server's exactly. This pins down the event-ordering
// machinery (Phase 1b) in ISOLATION from the client sim — so a later divergence can be
// blamed on the client, not the protocol. Headless + white-box (no ws, no timers).
//   node server/replay.test.mjs
process.env.SAND_EMIT_FRAMES = "1";   // turn on the frame log (must be set BEFORE requiring index.js)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Room } = require("./index.js");
const { SandSim } = require("../sim.js");

let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log((c ? "  ok  " : " FAIL ") + m); };
const stubWs = () => ({ send() {}, close() {}, readyState: 1 }); // join() needs a socket; we ignore its output

// Apply one frame event to a sim — the SAME mapping a real client will use.
function applyEv(s, ev) {
  if (ev.op === "join") s.addMember(ev.id, ev.color);
  else if (ev.op === "leave") s.removeMember(ev.id);
  else if (ev.op === "input") s.enqueue(ev.id, ev.delta);
  else if (ev.op === "spout") s.setSpout(ev.id, ev.size);
  else if (ev.op === "pour") s.setPour(ev.id, ev.on);
  else if (ev.op === "flood") s.setFlood(ev.id, ev.on);
  else if (ev.op === "reset") s.reset();
}

// --- drive a scripted scenario on a headless authoritative room, capturing frames ---
const room = new Room("replay", { noLoad: true, noAutoRun: true });
room.ensureRunning = () => {};        // join() calls this; keep the room timer-free for the test
const seed = room.sim.rngState;       // the replayer must start from the SAME seed (Phase 2: snapshot carries it)
const frames = [];                    // captured `frame` messages, in tick order
const serverChk = [];                 // server's grid checksum after each tick
room.broadcast = (m) => { if (m.type === "frame") frames.push(JSON.parse(JSON.stringify(m))); }; // capture only frames

const tickN = (n) => { for (let i = 0; i < n; i++) { room.tick(); serverChk.push(room.sim.checksum()); } };

const p1 = stubWs(), p2 = stubWs();
room.join(p1, "p1", "Alice");         // join → addMember event
room.join(p2, "p2", "Bob");
room.setSpout("p1", 4);               // spout event
room.onInput("p1", 200);              // input delta event (pour from queue)
room.onInput("p2", 120);
tickN(40);                            // pour + settle
room.onInput("p1", 600);              // more input mid-stream
room.setPour("p2", true);             // debug pour on
tickN(30);
room.setPour("p2", false);            // debug pour off
room.setFirehose("p1", true);         // flood on → fills fast (also exercises archive)
tickN(60);
room.drop(p1);                        // disconnect → flood/pour off events
tickN(20);
room.reset();                         // reset event → grid+archive cleared
room.onInput("p2", 320);
tickN(25);
room.leave("p2");                     // leave event
tickN(10);

// --- replay the frame log into a fresh sim and compare ---
const r = new SandSim({ rngState: seed }); // prod defaults (same H/COMPRESS as the room)
let mismatchAt = -1;
for (let i = 0; i < frames.length; i++) {
  for (const ev of frames[i].events) applyEv(r, ev);
  r.step();
  r.maybeArchive();                   // same order as Room.tick(): step → archive
  if (r.checksum() !== serverChk[i] && mismatchAt < 0) mismatchAt = i;
}

let grains = 0; for (const v of room.sim.grid) if (v) grains++;
const ops = new Set(frames.flatMap((f) => f.events.map((e) => e.op)));

ok(frames.length === serverChk.length && frames.length > 0, `captured one frame per tick (${frames.length})`);
ok(["join", "input", "spout", "pour", "flood", "leave", "reset"].every((o) => ops.has(o)), "frames carry every event type exercised");
ok(mismatchAt < 0, "replaying the frame log reproduces the server's per-tick checksum EXACTLY");
ok(grains >= 0 && frames.some((f) => f.events.length > 0), "frames actually carried events (not all empty)");

// negative control: a wrong seed must diverge SOMEWHERE in the trail (so the checksum is
// a real detector). Check the whole trail, not just the final tick — the scenario can end
// with grains still falling straight (no random slide), where the seed wouldn't matter.
const bad = new SandSim({ rngState: (seed ^ 0xdeadbeef) >>> 0 });
let anyDiff = false;
for (let i = 0; i < frames.length; i++) { for (const ev of frames[i].events) applyEv(bad, ev); bad.step(); bad.maybeArchive(); if (bad.checksum() !== serverChk[i]) anyDiff = true; }
ok(anyDiff, "a wrong seed diverges somewhere in the trail (checksum is a real divergence detector)");

console.log(`\n${fail ? "x" : "+"} ${pass} passed, ${fail} failed` + (mismatchAt >= 0 ? ` (first mismatch at tick ${mismatchAt})` : ""));
process.exit(fail ? 1 : 0);
