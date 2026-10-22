import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { CloudLink } from "./cloud-link.js";
import { ConsolePage } from "./console-page.js";
import { Room } from "./room.js";
import { SET_COPY_EVERY_MS, SetCopy } from "./set-copy.js";

/**
 * Oneverse Pulse's live engine (issue #247), the Node process on the mini PC:
 * the link to the cloud for one set, and the room's server (/sync, entered
 * with a pass the cloud signed, and GET /set), and Pulse's own page: the
 * operator's console, reached by "Continue on Pulse".
 *
 * ONEVERSE_API_URL  the API (https://api.oneverse.top)
 * PULSE_SET_ID      the set it mirrors
 * PULSE_NODE_ID     this Pulse's id (8 to 64 letters, digits, - and _)
 * PULSE_TOKEN       an API token of someone who can edit the set, until Pulse is paired like a screen
 * PULSE_DATA_DIR    where the set's copy is kept (./pulse-data)
 * PULSE_CONSOLE_DIR the page's build (the screen app's dist/pulse, beside this one in the repository)
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

const apiUrl = required("ONEVERSE_API_URL");
const setId = required("PULSE_SET_ID");
const token = async () => process.env.PULSE_TOKEN ?? null;
const log = (line: string) => console.log(line);
const link = new CloudLink({ apiUrl, setId, nodeId: required("PULSE_NODE_ID"), token, log });
const set = new SetCopy({ apiUrl, setId, token, dataDir: process.env.PULSE_DATA_DIR ?? "pulse-data", log });
await set.load();
// The set fetched again as soon as the cloud's there, and every few minutes while it is.
link.onStatus((status) => void (status === "online" && set.refresh()));
const refresher = setInterval(() => void (link.status === "online" && set.refresh()), SET_COPY_EVERY_MS);
link.start();

const page = new ConsolePage(process.env.PULSE_CONSOLE_DIR ?? fileURLToPath(new URL("../../screen/dist/pulse", import.meta.url)));
const server = createServer(async (request, response) => {
  if (await room.handle(request, response)) return;
  if (await page.handle(request, response)) return;
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(JSON.stringify({ cloud: link.status, session: link.engine.state?.sessionId ?? null, epoch: link.engine.state?.epoch ?? null }));
  }
  response.writeHead(404).end();
});
const room = new Room(server, link, setId, set);
server.listen(Number(process.env.PULSE_ROOM_PORT ?? 8788), process.env.PULSE_ROOM_HOST ?? "0.0.0.0");

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(refresher);
    room.close();
    server.close();
    link.stop();
    process.exit(0);
  });
