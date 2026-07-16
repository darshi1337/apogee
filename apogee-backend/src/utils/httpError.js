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
      next(new HttpError(422, result.error.issues));
      return;
    }
    req.body = result.data;
    next();
  };
}
