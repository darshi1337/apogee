import { getSettings } from "../storage/settings.js";
import {
  REMOTE_PROVIDER_IDS,
  normalizeRemoteModels,
  remotePreset,
  validRemoteModelId,
} from "./remoteModels.js";

const active = new Map();
const holds = new Map();
export const REMOTE_REQUEST_TIMEOUT_MS = 30000;
export const REMOTE_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_CHARS = 65536;
let storageEvents;

function watchCredentials() {
  const events = chrome.storage.onChanged;
  if (!events?.addListener || events === storageEvents) return;
  storageEvents = events;
  events.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    const { oldValue = {}, newValue = {} } = changes.settings;
    for (const provider of REMOTE_PROVIDER_IDS) {
      if (
        newValue[`${provider}Consent`] !== true ||
        oldValue[`${provider}ApiKey`] !== newValue[`${provider}ApiKey`]
      )
        abortRemoteRequests(provider);
    }
  });
}

export function abortRemoteRequests(provider) {
  remotePreset(provider);
  for (const controller of active.get(provider) || []) controller.abort();
}

export function holdRemoteRequests(provider, { abort = true } = {}) {
  remotePreset(provider);
  holds.set(provider, (holds.get(provider) || 0) + 1);
  if (abort) abortRemoteRequests(provider);
  return () => holds.set(provider, Math.max(0, (holds.get(provider) || 0) - 1));
}

export function remoteRequestsHeld(provider) {
  return (holds.get(provider) || 0) > 0;
}

async function withRemoteRequest(
  provider,
  endpoint,
  { signal, body, expected } = {},
  consume,
) {
  watchCredentials();
  const preset = remotePreset(provider);
  const controller = new AbortController();
  if (!active.has(provider)) active.set(provider, new Set());
  active.get(provider).add(controller);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, REMOTE_REQUEST_TIMEOUT_MS);
  let reader;
  let safeFailure =
    "Remote request failed. Check consent, credentials and connectivity.";
  try {
    const settings = await getSettings();
    if (controller.signal.aborted || holds.get(provider)) throw new Error();
    if (settings[`${provider}Consent`] !== true)
      throw new Error("Remote consent is required.");
    const apiKey = settings[`${provider}ApiKey`];
    if (!apiKey) throw new Error("A remote API key is required.");
    if (
      expected &&
      (apiKey !== expected.apiKey ||
        settings[`${provider}Model`] !== expected.model)
    )
      throw new Error();
    if (
      process.env.TARGET_BROWSER === "firefox" &&
      !(await chrome.permissions.contains({
        data_collection: ["authenticationInfo"],
      }))
    )
      throw new Error();
    if (controller.signal.aborted || holds.get(provider)) throw new Error();
    const response = await fetch(
      endpoint === "catalog"
        ? preset.catalog
        : `${preset.base}/chat/completions`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      },
    );
    if (!response.ok) {
      if (response.status === 401)
        safeFailure = "Remote authentication failed. Check your API key.";
      else if (response.status === 402 || response.status === 429)
        safeFailure =
          "Remote quota or credits are unavailable. Check your account and retry later.";
      else if (response.status === 403 || response.status === 404)
        safeFailure = "Remote access or model is unavailable for this account.";
      await response.body?.cancel().catch(() => {});
      throw new Error();
    }
    if (
      !response.body ||
      Number(response.headers.get("content-length")) > REMOTE_RESPONSE_MAX_BYTES
    ) {
      await response.body?.cancel().catch(() => {});
      throw new Error();
    }
    reader = response.body.getReader();
    let bytes = 0;
    const read = async () => {
      const result = await reader.read();
      if (controller.signal.aborted) throw new Error();
      bytes += result.value?.byteLength || 0;
      if (bytes > REMOTE_RESPONSE_MAX_BYTES) throw new Error();
      return result;
    };
    return await consume(read);
  } catch {
    // Never expose HTTP bodies, transport errors, keys or prompt text.
    throw new Error(
      controller.signal.aborted
        ? "Remote request cancelled or timed out."
        : safeFailure,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    active.get(provider).delete(controller);
  }
}

export async function fetchRemoteModels(provider, { signal } = {}) {
  return withRemoteRequest(provider, "catalog", { signal }, async (read) => {
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { value, done } = await read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    return normalizeRemoteModels(provider, JSON.parse(text + decoder.decode()));
  });
}

// Deliberately unregistered: Stage A exposes setup only. Future callers supply
// callbacks, never host, key, model, or consent overrides.
export async function streamRemoteChat(
  provider,
  prompt,
  { signal, system, onToken } = {},
) {
  const settings = await getSettings();
  const model = settings[`${provider}Model`];
  if (
    !validRemoteModelId(model) ||
    typeof prompt !== "string" ||
    prompt.length > 200000 ||
    (system != null && (typeof system !== "string" || system.length > 20000))
  )
    throw new Error("Invalid remote chat request.");
  const models = await fetchRemoteModels(provider, { signal });
  if (!models.some((entry) => entry.id === model))
    throw new Error("Select an eligible remote model.");
  const current = await getSettings();
  if (
    current[`${provider}Model`] !== model ||
    current[`${provider}ApiKey`] !== settings[`${provider}ApiKey`]
  )
    throw new Error("Remote settings changed. Retry the request.");
  const messages = [
    ...(system ? [{ role: "system", content: system }] : []),
    { role: "user", content: prompt },
  ];
  const body = {
    model,
    messages,
    stream: true,
    ...(provider === "openrouter"
      ? { provider: { max_price: { prompt: 0, completion: 0, request: 0 } } }
      : {}),
  };
  return withRemoteRequest(
    provider,
    "chat",
    {
      signal,
      body,
      expected: { apiKey: settings[`${provider}ApiKey`], model },
    },
    async (read) => {
      const decoder = new TextDecoder();
      let buffer = "";
      const event = (block) => {
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) return false;
        if (data === "[DONE]") return true;
        const parsed = JSON.parse(data);
        if (parsed.error) throw new Error();
        const token = parsed.choices?.[0]?.delta?.content;
        if (typeof token === "string") onToken?.(token);
        return false;
      };
      while (true) {
        const { value, done } = await read();
        buffer += done
          ? decoder.decode()
          : decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");
        let end;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (block.length > MAX_EVENT_CHARS) throw new Error();
          if (event(block)) return;
        }
        if (buffer.length > MAX_EVENT_CHARS) throw new Error();
        if (done) {
          if (event(buffer)) return;
          throw new Error();
        }
      }
    },
  );
}
