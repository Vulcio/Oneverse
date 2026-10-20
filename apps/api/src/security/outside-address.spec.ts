import { describe, expect, it } from "vite-plus/test";
import { checkOutsideUrl, isPublicAddress, OutsideAddressError } from "./outside-address.js";

describe("isPublicAddress", () => {
  it("refuses loopback, private, link-local, carrier-grade NAT and reserved addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1"])
      expect(isPublicAddress(address), address).toBe(false);
  });
  it("allows the public internet", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(address), address).toBe(true);
  });
  it("refuses what isn't an address", () => {
    expect(isPublicAddress("example.com")).toBe(false);
  });
});

describe("checkOutsideUrl", () => {
  const strict = { allowPrivate: false };
  it("asks for HTTPS and a public host", () => {
    expect(checkOutsideUrl("https://sonic.example.org/api", strict).hostname).toBe("sonic.example.org");
    for (const url of ["http://sonic.example.org", "https://localhost:8000", "https://127.0.0.1", "https://[::1]:8000", "https://10.0.0.5", "https://user:pass@sonic.example.org", "ftp://sonic.example.org", "not an address"])
      expect(() => checkOutsideUrl(url, strict), url).toThrow(OutsideAddressError);
  });
  it("allows http and private addresses when the instance's admin does", () => {
    expect(checkOutsideUrl("http://192.168.1.20:8000", { allowPrivate: true }).port).toBe("8000");
    expect(checkOutsideUrl("http://localhost:3998", { allowPrivate: true }).hostname).toBe("localhost");
  });
});
