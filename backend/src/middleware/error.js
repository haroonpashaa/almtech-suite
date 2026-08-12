export function notFound(req, res, next) {
  res.status(404);
  next(new Error(`Not found: ${req.originalUrl}`));
}

export function errorHandler(err, _req, res, _next) {
  // A controller that already set a status has chosen its own message deliberately —
  // those are safe, user-facing texts and are passed through untouched. Anything that
  // reaches here without a status is an unhandled fault, and its raw message may carry
  // database or driver internals, so it is classified and sanitised below.
  // A status may be chosen either by setting it on the response (the established
  // pattern) or by carrying it on the error — the latter is needed where the throw
  // happens deep inside a helper that has no access to `res`.
  const explicit = (res.statusCode && res.statusCode !== 200) || Number.isInteger(err.statusCode);
  let status = Number.isInteger(err.statusCode)
    ? err.statusCode
    : (res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);
  let message = err.message;

  if (!explicit) {
    if (err.name === 'CastError') {
      // e.g. an id typed into the URL by hand — a client mistake, not a server fault.
      status = 400;
      message = `Invalid ${err.path === '_id' ? 'id' : err.path || 'value'}`;
    } else if (err.name === 'ValidationError') {
      status = 400;
      message = Object.values(err.errors || {}).map((e) => e.message).join('; ') || 'Validation failed';
    } else if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'value';
      status = 409;
      message = `A record with this ${field} already exists`;
    } else {
      // Genuine server fault: never hand the client the internal message.
      status = 500;
      message = 'Something went wrong. Please try again, or contact support if it persists.';
    }
  }

  res.status(status).json({
    message,
    // Stack traces are opt-in and only for local development. Note this is an explicit
    // allow (NODE_ENV === 'development') rather than "anything except production", so an
    // unset NODE_ENV on a server never leaks internals.
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
}
