import test from "node:test";
import assert from "node:assert";

import { isGlobalIPv4 } from "../src/utils/ipv4.js";

// Reference values pulled from Python's ipaddress.IPv4Address(...).is_global,
// which the previous backend relied on for SSRF filtering.
test("isGlobalIPv4 matches Python's ipaddress.is_global", () => {
  const cases = [
    ["0.0.0.0", false],
    ["10.1.1.1", false],
    ["100.64.0.1", false], // carrier-grade NAT: neither private nor global
    ["127.0.0.1", false],
    ["169.254.1.1", false],
    ["172.16.0.1", false],
    ["192.0.0.1", false],
    ["192.0.0.9", true], // carved-out exception inside 192.0.0.0/24
    ["192.0.0.170", false],
    ["192.0.2.1", false],
    ["192.168.1.1", false],
    ["198.18.0.1", false],
    ["198.51.100.1", false],
    ["203.0.113.1", false],
    ["240.0.0.1", false],
    ["255.255.255.255", false],
    ["8.8.8.8", true],
    ["1.1.1.1", true],
  ];
  for (const [ip, expected] of cases) {
    assert.strictEqual(isGlobalIPv4(ip), expected, `${ip} should be ${expected}`);
  }
});
