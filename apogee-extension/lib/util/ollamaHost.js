const ALLOWED_OLLAMA_HOSTS = new Set(["127.0.0.1", "localhost"]);
const DEFAULT_OLLAMA_PORT = "11434";

export { ALLOWED_OLLAMA_HOSTS, DEFAULT_OLLAMA_PORT };

// Single shared loopback validator (see #210): the settings UI
// (validateOllamaHost below), the service worker (validateLoopbackHost), and
// the diagnostics host display all agree on one allowed set, one port rule,
// and one IPv6 stance. Only 127.0.0.1 and localhost are accepted - IPv6
// loopback ([::1] / ::1) is deliberately rejected so the validators, the
// diagnostics display, and the ERROR.md messaging cannot drift apart again.
export function validateLoopbackUrl(
  host,
  { label = "Ollama", defaultPort = DEFAULT_OLLAMA_PORT } = {},
) {
  let url;
  try {
    url = new URL(host);
  } catch {
    throw new Error(`Invalid ${label} host`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`Disallowed ${label} protocol: ${url.protocol}`);
  }
  if (!ALLOWED_OLLAMA_HOSTS.has(url.hostname)) {
    throw new Error(`Disallowed ${label} host: ${url.hostname}`);
  }
  if (!url.port) {
    url.port = defaultPort;
  }
  const portNum = Number(url.port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error(`Invalid ${label} port: ${url.port}`);
  }
  return url.toString().replace(/\/+$/, "");
}

export function validateOllamaHost(host) {
  return validateLoopbackUrl(host, {
    label: "Ollama",
    defaultPort: DEFAULT_OLLAMA_PORT,
  });
}
