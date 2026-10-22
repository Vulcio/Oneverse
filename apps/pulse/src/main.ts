import { CloudLink } from "./cloud-link.js";

/**
 * Oneverse Pulse's live engine (issue #247), the Node process on the mini PC:
 * for now, the link to the cloud for one set. The room's side - Pulse's own
 * page for Live and the console, reached by "Continue on Pulse" - comes next.
 *
 * ONEVERSE_API_URL  the API (https://api.oneverse.top)
 * PULSE_SET_ID      the set it mirrors
 * PULSE_NODE_ID     this Pulse's id (8 to 64 letters, digits, - and _)
 * PULSE_TOKEN       an API token of someone who can edit the set, until Pulse is paired like a screen
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

const link = new CloudLink({
  apiUrl: required("ONEVERSE_API_URL"),
  setId: required("PULSE_SET_ID"),
  nodeId: required("PULSE_NODE_ID"),
  token: async () => process.env.PULSE_TOKEN ?? null,
  log: (line) => console.log(line),
});
link.start();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (link.stop(), process.exit(0)));
