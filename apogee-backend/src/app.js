import express from "express";
import cors from "cors";

import { getCorsOriginRegex } from "./config.js";
import { HttpError } from "./utils/httpError.js";
import summarizeRouter from "./routes/summarize.js";
import healthRouter from "./routes/health.js";
import pdfRouter from "./routes/pdf.js";

const app = express();

// Custom header required on state-changing requests. This isn't a secret,
// the extension is open source, but a plain <form> POST or a "simple"
// (non-preflighted) cross-origin fetch can't set custom headers, so this
// forces even same-shaped-origin requests through a CORS preflight that the
// origin regex must approve first. It's defense-in-depth alongside the CORS
// check, not a replacement for it.
//
// Runs before body parsing below so a POST missing the header is rejected
// without spending the time/memory to parse a (potentially near-2mb) body
// that's just going to be discarded.
const REQUIRED_CLIENT_HEADER = "x-apogee-client";

app.use((req, res, next) => {
  if (req.method === "POST" && !(REQUIRED_CLIENT_HEADER in req.headers)) {
    res.status(403).json({ detail: "Missing required client header." });
    return;
  }
  next();
});

// 2mb headroom over the 500KB MAX_CONTENT_LENGTH enforced in route
// handlers, this only needs to be large enough that JSON-escaping
// overhead and the title/url fields never trip the parser first.
app.use(express.json({ limit: "2mb" }));

const corsOriginPattern = new RegExp(getCorsOriginRegex());

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header (e.g. curl, same-origin), allow, matching
      // Starlette's CORSMiddleware default behavior for non-CORS requests.
      callback(null, !origin || corsOriginPattern.test(origin));
    },
    credentials: false,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "x-apogee-client"],
  }),
);

app.get("/", (req, res) => res.redirect("/health"));

app.use(summarizeRouter);
app.use(healthRouter);
app.use(pdfRouter);

// Mirrors FastAPI's automatic HTTPException -> JSON error response.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ detail: err.detail });
    return;
  }
  console.error(err);
  res.status(500).json({ detail: "Internal server error" });
});

export default app;
