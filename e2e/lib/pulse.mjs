import { API, api } from "./harness.mjs";

/** A Oneverse Pulse paired by `who` to show `setId` (issue #320), as Pulse pairs itself: its token. */
export async function pairPulse(who, setId, name = "Pulse") {
  const started = await fetch(`${API}/screens/pairings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "PULSE" }) }).then((res) => res.json());
  await api(who, "POST", `/screens/pairings/${started.code}/confirm`, { name, setlistId: setId });
  const claimed = await fetch(`${API}/screens/pairings/${started.pairingId}/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: started.secret }) }).then((res) => res.json());
  if (!claimed.token) throw new Error(`Pulse not paired: ${JSON.stringify(claimed)}`);
  return claimed.token;
}
