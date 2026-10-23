import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { CloudLink } from "./cloud-link.js";
import { ConsolePage } from "./console-page.js";
import { Pairing } from "./pairing.js";
import { Room } from "./room.js";
import { SET_COPY_EVERY_MS, SetCopy } from "./set-copy.js";

/**
 * Oneverse Pulse's live engine (issue #247), the Node process on the mini PC:
 * paired like a screen (issue #320) - with no token yet it shows a code to
 * confirm in Screens, on /health and in its log - then the link to the
 * cloud for the set it's on (the one put on it, or the event's on now at
 * the location it follows), the room's server (/sync, entered with a pass
 * the cloud signed, and GET /set), and Pulse's own page: the operator's
 * console, reached by "Continue on Pulse".
 *
 * ONEVERSE_API_URL   the API (https://api.oneverse.top)
 * PULSE_NODE_ID      this Pulse's id (8 to 64 letters, digits, - and _)
 * PULSE_DATA_DIR     where its token and the set's copy are kept (./pulse-data)
 * PULSE_SCREEN_TOKEN its token, given rather than paired (left out: it pairs, and keeps it in PULSE_DATA_DIR)
 * PULSE_CONSOLE_DIR  the page's build (the screen app's dist/pulse, beside this one in the repository)
 * PULSE_ROOM_PORT    the room's server's port (8788); PULSE_ROOM_HOST its address (0.0.0.0: the venue's network)
 * PULSE_ROOM_URL     its address as the set's devices reach it (http://192.168.1.20:8788): told to them for
 *                    "Continue on Pulse"; by default its first local IPv4 address. A local address only.
 *
 * Disconnected in Screens, it says so in its log: delete PULSE_DATA_DIR/token and restart it to pair it again.
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
const dataDir = process.env.PULSE_DATA_DIR ?? "pulse-data";
const log = (line: string) => console.log(line);
const pairing = new Pairing({ apiUrl, dataDir, given: process.env.PULSE_SCREEN_TOKEN || undefined, log });
const token = () => pairing.current();
const port = Number(process.env.PULSE_ROOM_PORT ?? 8788);
/** This mini PC's first address on the venue's network. */
function roomUrl(): string | undefined {
  const address = Object.values(networkInterfaces())
    .flat()
    .find((one) => one && one.family === "IPv4" && !one.internal)?.address;
  return address ? `http://${address}:${port}` : undefined;
}
const link = new CloudLink({ apiUrl, nodeId: required("PULSE_NODE_ID"), roomUrl: process.env.PULSE_ROOM_URL ?? roomUrl(), token, log });
const set = new SetCopy({ apiUrl, token, dataDir, log });
await set.load();
// The set fetched again as soon as the cloud's there or puts it on another, and every few minutes while it's there.
link.onStatus((status) => void (status === "online" && set.refresh()));
link.onSet(() => void set.refresh());
const refresher = setInterval(() => void (link.status === "online" && set.refresh()), SET_COPY_EVERY_MS);
// Not paired yet: a code to confirm first.
void pairing.pair().then((paired) => paired && link.start());

const page = new ConsolePage(process.env.PULSE_CONSOLE_DIR ?? fileURLToPath(new URL("../../screen/dist/pulse", import.meta.url)));
const server = createServer(async (request, response) => {
  if (await room.handle(request, response)) return;
  if (await page.handle(request, response)) return;
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(JSON.stringify({ pairing: pairing.code, name: link.name, set: link.setId, cloud: link.status, session: link.engine.state?.sessionId ?? null, epoch: link.engine.state?.epoch ?? null }));
  }
  response.writeHead(404).end();
});
const room = new Room(server, link, set);
server.listen(port, process.env.PULSE_ROOM_HOST ?? "0.0.0.0");

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(refresher);
    pairing.stop();
    room.close();
    server.close();
    link.stop();
    process.exit(0);
  });
