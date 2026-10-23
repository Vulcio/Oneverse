import { API } from "./harness.mjs";

/**
 * A device on the API's /sync, signed in as `who` (issue #27): `next(match, ms)`
 * waits for the next message that matches (one that came early included),
 * null after `ms`; `send` sends one; `ready` is the sign-in's answer. `who`
 * may be `{ screenToken }`: a screen or a Pulse signed in by its own token,
 * `ready` then its `screen` message.
 */
export async function syncDevice(who) {
  const ws = new WebSocket(`${API.replace(/^http/, "ws")}/sync`);
  const messages = [];
  const waiting = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const w = waiting.find((one) => one.match(message));
    if (w) {
      waiting.splice(waiting.indexOf(w), 1);
      w.resolve(message);
    } else messages.push(message);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const next = (match, ms = 3000) =>
    new Promise((resolve) => {
      const early = messages.findIndex(match);
      if (early >= 0) return resolve(messages.splice(early, 1)[0]);
      const w = { match, resolve };
      waiting.push(w);
      setTimeout(() => {
        if (waiting.includes(w)) {
          waiting.splice(waiting.indexOf(w), 1);
          resolve(null);
        }
      }, ms);
    });
  const send = (message) => ws.send(JSON.stringify(message));
  const answer = next((m) => m.type === (who.screenToken ? "screen" : "ready") || m.type === "error");
  send(who.screenToken ? { type: "screen", token: who.screenToken } : { type: "hello", token: who.bearer });
  const ready = await answer;
  /** Forgets what came so far. */
  const drain = () => messages.splice(0);
  return { ready, next, send, drain, close: () => ws.close() };
}
