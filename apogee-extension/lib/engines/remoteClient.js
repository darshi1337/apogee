import { getRemoteCredentialsSettings } from "../storage/settings.js";
import {
  hasRemoteCatalogPermissions,
  hasRemoteGenerationPermissions,
  REMOTE_GENERATION_DATA,
  onRemoteCredentialChange,
  onRemoteGenerationChange,
} from "./remoteCredentials.js";
import {
  normalizeRemoteModels,
  remotePreset,
  validRemoteModelId,
} from "./remoteModels.js";
import { UserFacingError } from "../util/userError.js";

const active = new Map();
const holds = new Map();
// Connecting and stream reads share one idle window. The timer re-arms after
// every chunk, so a healthy long generation is not cut off at 30 seconds.
const REMOTE_IDLE_TIMEOUT_MS = 30000;
export const REMOTE_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_CHARS = 65536;
let watchedCredentials = false;

function watchCredentials() {
  if (watchedCredentials) return;
  watchedCredentials = true;
  onRemoteCredentialChange((provider) => abortRemoteRequests(provider));
  onRemoteGenerationChange((provider) => abortRemoteRequests(provider));
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
  { signal, url, method, body, expected, assertAuthorized } = {},
  consume,
) {
  watchCredentials();
  remotePreset(provider);
  const controller = new AbortController();
  if (!active.has(provider)) active.set(provider, new Set());
  active.get(provider).add(controller);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  // Abort mid-flight if the Firefox data-collection permission that allows
  // this request is revoked, so catalog and generation both fail closed.
  const onPermissionsRemoved = (permissions) => {
    const removed = permissions?.data_collection;
    if (!Array.isArray(removed) || removed.length === 0) return;
    const relevant = body ? REMOTE_GENERATION_DATA : ["authenticationInfo"];
    if (removed.some((category) => relevant.includes(category)))
      controller.abort();
  };
  chrome.permissions?.onRemoved?.addListener(onPermissionsRemoved);
  let timedOut = false;
  let timer;
  const armTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, REMOTE_IDLE_TIMEOUT_MS);
  };
  armTimeout();
  let reader;
  let safeFailure =
    "Remote request failed. Check consent, credentials and connectivity.";
  try {
    const settings = await getRemoteCredentialsSettings();
    if (controller.signal.aborted || holds.get(provider)) throw new Error();
    if (settings[`${provider}Consent`] !== true)
      throw new Error("Remote consent is required.");
    const apiKey = settings[`${provider}ApiKey`];
    if (!apiKey) throw new Error("A remote API key is required.");
    if (
      expected &&
      (apiKey !== expected.apiKey ||
        settings[`${provider}Model`] !== expected.model ||
        settings[`${provider}GenerationRevision`] !== expected.revision)
    )
      throw new Error();
    if (body) {
      if (
        settings[`${provider}GenerationConsent`] !== true ||
        !(await hasRemoteGenerationPermissions())
      )
        throw new Error();
      await assertAuthorized?.();
    } else if (!(await hasRemoteCatalogPermissions())) throw new Error();
    if (controller.signal.aborted || holds.get(provider)) throw new Error();
    const response = await fetch(url, {
      method: method || (body ? "POST" : "GET"),
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
    });
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
    // Headers arrived. The idle window now covers the first chunk and every
    // gap between chunks, not the total stream duration.
    armTimeout();
    reader = response.body.getReader();
    let bytes = 0;
    const read = async () => {
      const result = await reader.read();
      if (controller.signal.aborted) throw new Error();
      armTimeout();
      bytes += result.value?.byteLength || 0;
      if (bytes > REMOTE_RESPONSE_MAX_BYTES) throw new Error();
      return result;
    };
    return await consume(read);
  } catch {
    // Never expose HTTP bodies, transport errors, keys or prompt text.
    throw new UserFacingError(
      controller.signal.aborted
        ? timedOut
          ? "Remote request timed out. Retry later."
          : "Remote request cancelled."
        : safeFailure,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    chrome.permissions?.onRemoved?.removeListener(onPermissionsRemoved);
    controller.abort();
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    active.get(provider).delete(controller);
  }
}

export async function fetchRemoteModels(provider, { signal } = {}) {
  const preset = remotePreset(provider);
  return withRemoteRequest(
    provider,
    { signal, url: preset.catalog, method: "GET" },
    async (read) => {
      const text = await readText(read);
      return normalizeRemoteModels(provider, JSON.parse(text));
    },
  );
}

async function readText(read) {
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function streamRemoteChat(
  provider,
  prompt,
  { signal, system, onToken, assertAuthorized, catalog } = {},
) {
  await assertAuthorized?.();
  const settings = await getRemoteCredentialsSettings();
  if (settings[`${provider}GenerationConsent`] !== true)
    throw new UserFacingError("Remote generation consent is required.");
  const model = settings[`${provider}Model`];
  if (
    !validRemoteModelId(model) ||
    typeof prompt !== "string" ||
    prompt.length > 200000 ||
    (system != null && (typeof system !== "string" || system.length > 20000))
  )
    throw new UserFacingError("Invalid remote chat request.");
  // Background jobs already hold a fresh catalog from job creation. Reusing it
  // avoids one catalog GET before every map/reduce request.
  const models = Array.isArray(catalog)
    ? catalog
    : await fetchRemoteModels(provider, { signal });
  if (!models.some((entry) => entry.id === model))
    throw new UserFacingError("Select an eligible remote model.");
  await assertAuthorized?.();
  const current = await getRemoteCredentialsSettings();
  if (
    current[`${provider}Model`] !== model ||
    current[`${provider}ApiKey`] !== settings[`${provider}ApiKey`] ||
    current[`${provider}GenerationConsent`] !== true ||
    current[`${provider}GenerationRevision`] !==
      settings[`${provider}GenerationRevision`]
  )
    throw new UserFacingError("Remote settings changed. Retry the request.");
  const messages = [
    ...(system ? [{ role: "system", content: system }] : []),
    { role: "user", content: prompt },
  ];
  const body = {
    model,
    messages,
    stream: true,
    ...(provider === "openrouter"
      ? {
          provider: {
            max_price: { prompt: 0, completion: 0, request: 0 },
            allow_fallbacks: false,
          },
        }
      : {}),
  };
  const preset = remotePreset(provider);
  return withRemoteRequest(
    provider,
    {
      signal,
      url: `${preset.base}/chat/completions`,
      method: "POST",
      body,
      expected: {
        apiKey: settings[`${provider}ApiKey`],
        model,
        revision: settings[`${provider}GenerationRevision`],
      },
      assertAuthorized,
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
