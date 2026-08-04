export interface InterfaceAddr {
  name: string;
  address: string;
}

const NOISE_RE =
  /^(docker|veth|virbr|br-|vmnet|vbox|tun|tap|ppp|cilium|flannel|podman)/;
const VIRTUAL_RE = /^(tailscale|wg|utun|zt|zerotier|tun)/;
const CGNAT_RE = /^100\.(6[4-9]|[7-9]\d)\./;
const LINK_LOCAL_RE = /^169\.254\./;

function score(iface: InterfaceAddr, defaultIface: string | null): number {
  let s = 0;
  if (defaultIface && iface.name === defaultIface) s += 4;
  if (VIRTUAL_RE.test(iface.name)) s -= 2;
  if (CGNAT_RE.test(iface.address)) s -= 1;
  if (LINK_LOCAL_RE.test(iface.address)) s -= 2;
  return s;
}

export function getDefaultIfaceName(): string | null {
  try {
    const route = new TextDecoder().decode(
      Deno.readFileSync("/proc/net/route"),
    );
    for (const line of route.split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length >= 2 && fields[1] === "00000000") {
        return fields[0] || null;
      }
    }
  } catch {
    // fall through to ranking heuristics
  }
  return null;
}

export function rankIfaces(
  ifaces: InterfaceAddr[],
  defaultIface: string | null,
): InterfaceAddr[] {
  const seen = new Set<string>();
  const candidates = ifaces.filter((i) => {
    if (i.name === "lo" || NOISE_RE.test(i.name)) return false;
    if (seen.has(i.address)) return false;
    seen.add(i.address);
    return true;
  });
  candidates.sort((a, b) => {
    const diff = score(b, defaultIface) - score(a, defaultIface);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });
  return candidates;
}

export function rankAddrs(
  ifaces: InterfaceAddr[],
  defaultIface: string | null,
): string[] {
  return rankIfaces(ifaces, defaultIface).map((i) => i.address);
}

export function getAllInterfaces(): InterfaceAddr[] {
  const ifaces = Deno.networkInterfaces().filter(
    (i) => i.family === "IPv4",
  ).map((i) => ({ name: i.name, address: i.address }));
  return rankIfaces(ifaces, getDefaultIfaceName());
}

export function getAllAddrs(): string[] {
  return getAllInterfaces().map((i) => i.address);
}

export function getDefaultAddr(): string {
  return getAllAddrs().at(0) ?? "localhost";
}
