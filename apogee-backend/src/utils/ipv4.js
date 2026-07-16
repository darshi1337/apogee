// Mirrors Python's ipaddress.IPv4Address.is_global, which the previous
// backend used for SSRF filtering. There's no equivalent in Node's stdlib,
// so the private-network ranges are ported directly from cpython's
// Lib/ipaddress.py (_IPv4Constants) to keep identical SSRF behavior.
const PRIVATE_NETWORKS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.0.170/31",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "240.0.0.0/4",
  "255.255.255.255/32",
];

// Specific addresses carved back out of the private ranges above (e.g.
// 192.0.0.9/32 and 192.0.0.10/32 sit inside 192.0.0.0/24 but are globally
// routable IANA/AMT anycast addresses) — same exceptions cpython applies.
const PRIVATE_NETWORK_EXCEPTIONS = ["192.0.0.9/32", "192.0.0.10/32"];

// Carrier-grade NAT (RFC 6598): cpython treats this range as neither
// private nor global — `is_global` is False here even though it's not in
// PRIVATE_NETWORKS above, so it needs its own exclusion.
const SHARED_ADDRESS_SPACE = "100.64.0.0/10";

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) throw new Error(`invalid IPv4 address: ${ip}`);
  let n = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      throw new Error(`invalid IPv4 address: ${ip}`);
    }
    n = (n << 8) | octet;
  }
  return n >>> 0;
}

function inCidr(ipInt, cidr) {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (ipv4ToInt(base) & mask);
}

/** True unless `ip` falls in a private/reserved/loopback/etc. range. */
export function isGlobalIPv4(ip) {
  let ipInt;
  try {
    ipInt = ipv4ToInt(ip);
  } catch {
    return false;
  }
  if (inCidr(ipInt, SHARED_ADDRESS_SPACE)) return false;
  const isPrivate =
    PRIVATE_NETWORKS.some((cidr) => inCidr(ipInt, cidr)) &&
    !PRIVATE_NETWORK_EXCEPTIONS.some((cidr) => inCidr(ipInt, cidr));
  return !isPrivate;
}
