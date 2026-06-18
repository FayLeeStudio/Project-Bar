// Backend smoke test (not shipped): drives a room like two browser tabs would —
// join, report progress, and assert the broadcast `state` carries both players
// with the right ticks, keyed by the ?_pk connection ids.
// Run `npm run party:dev` (wrangler dev) first, then `node party/smoke-test.mjs`.

const HOST = "127.0.0.1:8787";
const ROOM = "smoke";
const url = (id) => `ws://${HOST}/parties/main/${ROOM}?_pk=${id}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (ws) => new Promise((res, rej) => {
  ws.onopen = () => res();
  ws.onerror = (e) => rej(new Error("ws error: " + (e.message || "connect failed")));
});

let lastA = null, lastB = null;

const a = new WebSocket(url("alice"));
const b = new WebSocket(url("bob"));
a.onmessage = (e) => { lastA = JSON.parse(e.data); };
b.onmessage = (e) => { lastB = JSON.parse(e.data); };

await Promise.all([open(a), open(b)]);

a.send(JSON.stringify({ type: "join", name: "Alice" }));
b.send(JSON.stringify({ type: "join", name: "Bob" }));
await wait(150);

a.send(JSON.stringify({ type: "progress", ticks: 42 }));
b.send(JSON.stringify({ type: "progress", ticks: 67 }));
await wait(150);

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok  -", msg);
}

const players = lastA?.players ?? {};
assert(lastA?.type === "state", "client A received a state broadcast");
assert(Object.keys(players).length === 2, "room has exactly 2 players");
assert(players.alice?.name === "Alice" && players.alice?.ticks === 42, "alice -> Alice @ 42 (id from ?_pk)");
assert(players.bob?.name === "Bob" && players.bob?.ticks === 67, "bob -> Bob @ 67 (id from ?_pk)");
assert(lastB?.players?.bob?.ticks === 67, "client B sees the same shared state");

// closing one connection should drop it from everyone's state
b.close();
await wait(200);
assert(Object.keys(lastA?.players ?? {}).length === 1 && !lastA.players.bob, "leaving removes the player from the broadcast");

console.log("\nALL PASSED");
a.close();
process.exit(0);
