/**
 * One error shape for the whole API, so the client never has to guess.
 *
 *   { "error": { "code": "...", "message": "...", "details": { } } }
 */
export class AppError extends Error {
  /**
   * @param {string} code machine-readable code
   * @param {string} message human-readable message
   * @param {{ status?: number, details?: object }} [options]
   */
  constructor(code, message, { status = 400, details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Read a single cookie out of a Cookie header. */
export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

/**
 * The single place an error turns into a response.
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // A malformed JSON body is the client's mistake, not ours.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'invalid_request', message: 'The request body is not valid JSON.' },
    });
  }

  if (err instanceof AppError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details) body.error.details = err.details;
    return res.status(err.status).json(body);
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong.' },
  });
}

/** A JSON 404 for anything under /api that did not match a route. */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'not_found', message: 'No such endpoint.' },
  });
}
