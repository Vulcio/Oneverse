import { createServer } from "node:http";
import { CloudLink } from "./cloud-link.js";
import { Room } from "./room.js";

/**
 * Oneverse Pulse's live engine (issue #247), the Node process on the mini PC:
 * the link to the cloud for one set, and the room's server (/sync, entered
 * with a pass the cloud signed). Pulse's own page for Live and the console,
 * reached by "Continue on Pulse", comes next.
 *
 * ONEVERSE_API_URL  the API (https://api.oneverse.top)
 * PULSE_SET_ID      the set it mirrors
 * PULSE_NODE_ID     this Pulse's id (8 to 64 letters, digits, - and _)
 * PULSE_TOKEN       an API token of someone who can edit the set, until Pulse is paired like a screen
 * PULSE_ROOM_PORT   the room's server's port (8788); PULSE_ROOM_HOST its address (0.0.0.0: the venue's network)
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

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(JSON.stringify({ cloud: link.status, session: link.engine.state?.sessionId ?? null, epoch: link.engine.state?.epoch ?? null }));
  }
  response.writeHead(404).end();
});
const room = new Room(server, link, required("PULSE_SET_ID"));
server.listen(Number(process.env.PULSE_ROOM_PORT ?? 8788), process.env.PULSE_ROOM_HOST ?? "0.0.0.0");

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    room.close();
    server.close();
    link.stop();
    process.exit(0);
  });
