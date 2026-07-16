import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Router } from "express";

import { allowLocalPdfAccess } from "../config.js";
import { PdfUrlRequestSchema } from "../models/requestSchemas.js";
import { extractPdfText, PdfExtractionError } from "../services/pdfService.js";
import { summarizeText } from "../services/summaryService.js";
import { HttpError, validateBody } from "../utils/httpError.js";
import { isGlobalIPv4 } from "../utils/ipv4.js";

const router = Router();

// Maximum extracted text length accepted (approximately 500 KB).
const MAX_CONTENT_LENGTH = 500_000;

// Maximum number of HTTP redirects to follow when downloading a remote PDF.
// Each hop is re-validated against the SSRF allow-list, a redirect to a
// private/loopback address must not be followed blindly.
const MAX_REDIRECTS = 5;

// Hard ceiling on a downloaded PDF's raw byte size. The 500KB
// MAX_CONTENT_LENGTH above only bounds *extracted text*, checked well after
// the whole file has already been downloaded and parsed, an unbounded
// response body (e.g. a multi-GB URL) would otherwise let a remote server
// OOM this process before that check ever runs.
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

// Wall-clock ceiling per hop, independent of the socket idle timeout below.
// A server that trickles a few bytes every few seconds never trips an idle
// timeout but can still tie up the connection (and this request) forever.
const FETCH_DEADLINE_MS = 30_000;

// realpath() so symlinked roots (e.g. macOS /tmp -> /private/tmp) match.
// Deliberately narrow: the whole home directory used to be in-scope, which
// meant any origin allowed by CORS could read *any* PDF the user owns. Only
// the common "I just downloaded/saved a PDF" locations are trusted by
// default; extend via APOGEE_PDF_ALLOWED_DIRS (colon-separated) if needed.
function safeRealpathSync(p) {
  // fs.realpathSync throws on a nonexistent path; os.path.realpath in
  // Python doesn't. Falling back to a plain normalize keeps that behavior,
  // callers that need the path to exist check separately (see
  // validateLocalPath's isFile check below).
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function defaultPdfRoots() {
  const roots = [
    safeRealpathSync(os.tmpdir()),
    safeRealpathSync("/tmp"),
    safeRealpathSync(path.join(os.homedir(), "Downloads")),
  ];
  const extra = process.env.APOGEE_PDF_ALLOWED_DIRS ?? "";
  for (const entry of extra.split(path.delimiter)) {
    const trimmed = entry.trim();
    if (trimmed) roots.push(safeRealpathSync(expandHome(trimmed)));
  }
  return roots;
}

export const ALLOWED_PDF_ROOTS = defaultPdfRoots();

// commonpath-style containment (not startsWith on the raw string) so
// "/tmpfoo" isn't treated as under "/tmp".
function isWithinAllowedRoots(resolved) {
  return ALLOWED_PDF_ROOTS.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep),
  );
}

/** Reject URLs that target private/loopback addresses (SSRF protection). */
export async function isSafeRemoteUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, ip: "" };
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    return { safe: false, ip: "" };
  if (!parsed.hostname) return { safe: false, ip: "" };

  try {
    // family: 4 to match Python's socket.gethostbyname, which only
    // resolves A records.
    const { address } = await dns.promises.lookup(parsed.hostname, {
      family: 4,
    });
    return { safe: isGlobalIPv4(address), ip: address };
  } catch {
    return { safe: false, ip: "" };
  }
}

// Per-request DNS pin passed via the `lookup` option on http(s).request.
// Python's version monkey-patched the process-global socket.getaddrinfo
// (behind a lock, since two concurrent requests would otherwise clobber
// each other's pin). Node's request-level `lookup` option pins DNS for
// just this one connection, so no global mutation or lock is needed.
export function pinnedLookup(pinnedHost, pinnedIp) {
  return (hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (hostname === pinnedHost) {
      if (options && options.all) {
        callback(null, [{ address: pinnedIp, family: 4 }]);
      } else {
        callback(null, pinnedIp, 4);
      }
      return;
    }
    dns.lookup(hostname, options, callback);
  };
}

function fetchOnce(
  url,
  {
    lookup,
    idleTimeoutMs,
    deadlineMs = FETCH_DEADLINE_MS,
    maxBytes = MAX_DOWNLOAD_BYTES,
  },
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const client = url.startsWith("https:") ? https : http;
    const req = client.request(
      url,
      { method: "GET", lookup, timeout: idleTimeoutMs },
      (res) => {
        const declaredLength = Number(res.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          req.destroy(
            new Error(
              `response too large (${declaredLength} bytes, max ${maxBytes})`,
            ),
          );
          return;
        }

        const chunks = [];
        let received = 0;
        res.on("data", (chunk) => {
          received += chunk.length;
          // A malicious/misconfigured server can omit or lie about
          // Content-Length, so the running total is checked too, not just
          // the declared header above.
          if (received > maxBytes) {
            req.destroy(new Error(`response exceeded ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          settled = true;
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", (err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      },
    );

    const deadline = setTimeout(() => {
      req.destroy(new Error("request exceeded overall time limit"));
    }, deadlineMs);
    req.on("close", () => clearTimeout(deadline));

    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    req.end();
  });
}

/**
 * Download a PDF, re-validating the SSRF allow-list on every redirect hop.
 *
 * A plain fetch-with-redirects would only validate the *original* host, so
 * a public URL that passes the initial check could 302 to a private/
 * loopback address and reach internal services. Each hop is validated and
 * DNS-pinned independently instead.
 *
 * `fetchOnceFn` is an injectable seam for tests, production callers never
 * need to pass it.
 */
export async function fetchPdfWithValidatedRedirects(
  url,
  { fetchOnceFn = fetchOnce } = {},
) {
  let currentUrl = url;

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
    const { safe, ip } = await isSafeRemoteUrl(currentUrl);
    if (!safe) {
      throw new HttpError(
        400,
        "URL is not allowed: only public http/https URLs are accepted.",
      );
    }

    const parsed = new URL(currentUrl);
    let response;
    try {
      response = await fetchOnceFn(currentUrl, {
        lookup: pinnedLookup(parsed.hostname, ip),
        idleTimeoutMs: 30_000,
      });
    } catch (err) {
      throw new HttpError(502, `Failed to download PDF: ${err.message}`);
    }

    const location = response.headers.location;
    if (response.statusCode >= 300 && response.statusCode < 400) {
      if (!location) {
        throw new HttpError(
          502,
          "Failed to download PDF: redirect with no Location header.",
        );
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (response.statusCode >= 400) {
      throw new HttpError(
        502,
        `Failed to download PDF: HTTP ${response.statusCode}.`,
      );
    }
    return response.body;
  }

  throw new HttpError(502, "Failed to download PDF: too many redirects.");
}

/** Resolve a local path and ensure it is within allowed roots and is a PDF. */
export function validateLocalPath(rawPath) {
  const resolved = safeRealpathSync(rawPath);

  if (!resolved.toLowerCase().endsWith(".pdf")) {
    throw new HttpError(400, "Only .pdf files are allowed for local access.");
  }
  if (!isWithinAllowedRoots(resolved)) {
    throw new HttpError(
      403,
      "Access denied: path is outside allowed directories.",
    );
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new HttpError(404, "File not found.");
  }
  return resolved;
}

router.post("/pdf/url", validateBody(PdfUrlRequestSchema), async (req, res) => {
  const { url, mode, model } = req.body;
  const isLocal = url.startsWith("file:///");

  let pdfPath;
  if (isLocal) {
    if (!allowLocalPdfAccess()) {
      throw new HttpError(
        403,
        "Local PDF access is disabled on this Apogee server.",
      );
    }
    let rawPath;
    try {
      // Parse as a URL (not a raw slice) so a query string or fragment,
      // e.g. file:///doc.pdf#page=2, which is what a link to a specific PDF
      // page looks like, doesn't get appended onto the path and trip the
      // .pdf extension check below.
      rawPath = decodeURIComponent(new URL(url).pathname);
    } catch {
      throw new HttpError(400, "Malformed file URL.");
    }
    pdfPath = validateLocalPath(rawPath);
  } else {
    const content = await fetchPdfWithValidatedRedirects(url);
    pdfPath = path.join(os.tmpdir(), `apogee-pdf-${randomUUID()}.pdf`);
    await writeFile(pdfPath, content, { flag: "wx" });
  }

  let text;
  try {
    text = await extractPdfText(pdfPath);
  } catch (err) {
    if (!(err instanceof PdfExtractionError)) throw err;
    throw new HttpError(422, `Could not read PDF: ${err.message}`);
  } finally {
    // Clean up downloaded temp files (not local user files).
    if (!isLocal) {
      await unlink(pdfPath).catch(() => {});
    }
  }

  if (!text.trim()) {
    throw new HttpError(422, "Could not extract text from the PDF.");
  }
  if (text.length > MAX_CONTENT_LENGTH) {
    throw new HttpError(
      413,
      `Extracted PDF text too large (${text.length} chars). Maximum is ${MAX_CONTENT_LENGTH}.`,
    );
  }

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  res.type("text/plain");
  try {
    for await (const token of summarizeText({
      text,
      title: "PDF Document",
      url,
      mode,
      model,
      signal: controller.signal,
    })) {
      if (controller.signal.aborted) break;
      res.write(token);
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});

export default router;
