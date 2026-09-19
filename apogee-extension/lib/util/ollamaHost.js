import { DEFAULT_LLAMACPP_HOST } from "../constants.js";

const ALLOWED_OLLAMA_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const DEFAULT_OLLAMA_PORT = "11434";

export { ALLOWED_OLLAMA_HOSTS, DEFAULT_OLLAMA_PORT };

// Single shared loopback validator (see #210): the settings UI
// (validateOllamaHost below), the service worker (validateLoopbackHost), and
// the diagnostics host display all agree on one allowed set, one port rule,
// and one IPv6 stance. 127.0.0.1, localhost, and the IPv6 loopback [::1] are
// accepted - every one of them is loopback, so page text still never leaves
// the machine.
export function validateLoopbackUrl(
  host,
  { label = "Ollama", defaultPort = DEFAULT_OLLAMA_PORT } = {},
) {
  const text = String(host ?? "").trim();
  let url;
  try {
    if (!text) throw new Error("empty");
    url = new URL(text);
  } catch {
    throw new Error(`Invalid ${label} host`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`Disallowed ${label} protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error(`Disallowed ${label} userinfo`);
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
  // Normalize to the origin: a pasted path, query, or fragment (including a
  // bare trailing slash) must not ride along into `${host}/api/chat` and
  // produce a 404 that looks like Ollama is down.
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

// The engine clients accept raw settings hosts, so they strip trailing
// slashes at the call site: otherwise a slash rides into `${host}/api/...`
// and produces a 404 that looks like the server is down.
export function stripTrailingSlashes(host) {
  return String(host ?? "").replace(/\/+$/, "");
}

export function validateOllamaHost(host) {
  return validateLoopbackUrl(host, {
    label: "Ollama",
    defaultPort: DEFAULT_OLLAMA_PORT,
  });
}

function llamaDefaultPort() {
  try {
    return new URL(DEFAULT_LLAMACPP_HOST).port || "8080";
  } catch {
    return "8080";
  }
}

export function validateLlamaHost(host) {
  return validateLoopbackUrl(host, {
    label: "llama.cpp",
    defaultPort: llamaDefaultPort(),
  });
}
