/** Mirrors FastAPI's HTTPException(status_code, detail) for the Express error middleware in app.js. */
export class HttpError extends Error {
  constructor(statusCode, detail) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Flatten zod's issue objects into a single human-readable line. The
      // extension surfaces this string straight to the user, so the raw
      // issues array (what this used to return) would show up as JSON noise.
      const detail = result.error.issues
        .map((issue) => {
          const field = issue.path.join(".") || "body";
          return `${field}: ${issue.message}`;
        })
        .join("; ");
      next(new HttpError(422, detail || "Invalid request body."));
      return;
    }
    req.body = result.data;
    next();
  };
}
