import { assertEquals } from "@std/assert";
import { rankAddrs, rankIfaces } from "./addr.ts";

const defaultIface = "wlan0";

const ifaces = [
  { name: "lo", address: "127.0.0.1" },
  { name: "docker0", address: "172.17.0.1" },
  { name: "tailscale0", address: "100.84.173.7" },
  { name: "wlan0", address: "192.168.1.38" },
  { name: "enp4s0", address: "192.168.1.39" },
];

Deno.test("ranks default-route interface first", () => {
  const result = rankAddrs(ifaces, defaultIface);
  assertEquals(result[0], "192.168.1.38");
});

Deno.test("excludes loopback and docker noise", () => {
  const result = rankAddrs(ifaces, defaultIface);
  assertEquals(result.includes("127.0.0.1"), false);
  assertEquals(result.includes("172.17.0.1"), false);
});

Deno.test("keeps tailscale but ranks it below LAN when a default exists", () => {
  const result = rankAddrs(ifaces, defaultIface);
  const lanIndex = result.indexOf("192.168.1.38");
  const tailIndex = result.indexOf("100.84.173.7");
  assertEquals(tailIndex > -1, true);
  assertEquals(lanIndex < tailIndex, true);
});

Deno.test("falls back to first non-noise interface without a default", () => {
  const result = rankAddrs(ifaces, null);
  const tailIndex = result.indexOf("100.84.173.7");
  const lanIndex = result.indexOf("192.168.1.38");
  // tailscale (score -2) loses to LAN interfaces (score 0)
  assertEquals(tailIndex > lanIndex, true);
});

Deno.test("dedupes duplicate addresses", () => {
  const dup = [
    ...ifaces,
    { name: "enp4s1", address: "192.168.1.38" },
  ];
  const result = rankAddrs(dup, defaultIface);
  assertEquals(
    result.filter((a) => a === "192.168.1.38").length,
    1,
  );
});

Deno.test("rankIfaces returns name+address pairs", () => {
  const result = rankIfaces(ifaces, defaultIface);
  assertEquals(result[0].name, "wlan0");
  assertEquals(result[0].address, "192.168.1.38");
});
