// Determinism contract test — sync-architecture acceptance A: the sim is a PURE
// FUNCTION of (rngState + inputs). Drive the same seeded, headless room twice with
// identical inputs and assert the per-tick grid checksums match exactly; assert a
// DIFFERENT seed diverges (so the randomness is real, not a constant). White-box: it
// imports Room directly (no timers, no disk, no ws) — that's why index.js guards
// server.listen behind require.main and exports Room.
//   node server/determinism.test.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Room } = require("./index.js");

let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log((c ? "  ok  " : " FAIL ") + m); };
const member = (color) => ({ color, ticks: 0, contributionTicks: 0, joinedAt: 0 });

// Build a headless room, force the seed, add two pourers at different spouts, and run
// N ticks feeding identical input each tick. Returns the full per-tick checksum trail
// (+ grain count) — same seed + same inputs ⇒ identical trail.
function run(seed, ticks) {
  const r = new Room("det", { noLoad: true, noAutoRun: true });
  r.rngState = seed >>> 0;
  r.members = { a: member("amber"), c: member("violet") };
  r.spoutSize = { a: 4, c: 4 };           // wider brush → more grains → exercises the random slide a lot
  const trail = [];
  for (let t = 0; t < ticks; t++) {
    r.queues.a = (r.queues.a || 0) + 12;  // identical, fully deterministic input every tick
    r.queues.c = (r.queues.c || 0) + 12;
    r.tick();
    trail.push(r.checksum());
  }
  let grains = 0; for (const v of r.grid) if (v) grains++;
  return { trail, grains };
}

const N = 300;
const A = run(0x12345678, N);
const B = run(0x12345678, N);   // same seed + inputs as A
const C = run(0x9abcdef0, N);   // different seed

ok(A.grains > 0, "sand accumulated (the dl&&dr random slide branch is actually exercised)");
ok(A.trail.length === N && A.trail.every((h, i) => h === B.trail[i]), "same seed + same inputs ⇒ identical per-tick checksum trail");
ok(A.trail[N - 1] === B.trail[N - 1], "final grid checksum matches across two runs");
ok(C.trail[N - 1] !== A.trail[N - 1], "a different seed diverges (randomness is real, seed matters)");

console.log(`\n${fail ? "x" : "+"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
