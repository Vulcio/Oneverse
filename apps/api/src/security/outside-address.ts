/**
 * Calls to an address someone other than the instance's admin entered - a
 * team's or an organisation's own Songverse Sonic server (issue #300) -
 * held to the rules of an outside download (issue #112): HTTPS only, and
 * never a private, local or otherwise internal address unless the
 * instance's admin allows them (servers on the same network). The address
 * is checked where the connection is made, on every address its name
 * resolves to, so a name that later resolves elsewhere (DNS rebinding)
 * is refused too. Redirects are refused by the callers (`redirect: "error"`).
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent } from "undici";

export class OutsideAddressError extends Error {}

export interface OutsideAddressRules {
  /** Private, local and internal addresses allowed, and plain http:// with them. */
  allowPrivate: boolean;
}

/** Addresses that aren't the public internet: loopback, private, link-local, carrier-grade NAT, multicast, reserved, and their IPv6 forms. */
const INTERNAL = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  INTERNAL.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  INTERNAL.addSubnet(network, prefix, "ipv6");

/** Whether an IP address is on the public internet. An IPv4 address written as IPv6 (::ffff:10.0.0.1) is checked as IPv4. */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return isPublicAddress(mapped);
  const family = isIP(address);
  if (family === 0) return false;
  return !INTERNAL.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Refuses an address the rules don't allow, before anything is sent: its scheme, and its host when it's an IP. */
export function checkOutsideUrl(url: string, rules: OutsideAddressRules): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OutsideAddressError("That isn't an address");
  }
  if (parsed.protocol !== "https:" && !(rules.allowPrivate && parsed.protocol === "http:")) throw new OutsideAddressError("The address must start with https://");
  if (parsed.username || parsed.password) throw new OutsideAddressError("The address can't hold a user name or password");
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!rules.allowPrivate && (host === "localhost" || host.endsWith(".localhost") || (isIP(host) && !isPublicAddress(host)))) throw new OutsideAddressError("The address must be on the internet, not a private or local one");
  return parsed;
}

const agents = new Map<boolean, Agent>();

/** The connection pool calls under these rules go through: every address a name resolves to is checked as it connects. */
export function outsideDispatcher(rules: OutsideAddressRules): Agent {
  let agent = agents.get(rules.allowPrivate);
  if (!agent) {
    const lookup = (hostname: string, options: object, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) =>
      dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error, []);
        const refused = rules.allowPrivate ? undefined : addresses.find((one) => !isPublicAddress(one.address));
        if (refused) return callback(Object.assign(new OutsideAddressError(`${hostname} is a private or local address (${refused.address})`), { code: "EOUTSIDEADDRESS" }), []);
        // Asked for one (as net.connect does without autoSelectFamily): the first; else them all.
        if ((options as { all?: boolean }).all) return callback(null, addresses);
        callback(null, addresses[0]!.address, addresses[0]!.family);
      });
    agent = new Agent({ connect: { lookup } });
    agents.set(rules.allowPrivate, agent);
  }
  return agent;
}
