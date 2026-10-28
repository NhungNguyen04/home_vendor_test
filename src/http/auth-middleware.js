import { AppError, readCookie } from './errors.js';

export const SESSION_COOKIE = 'session';

/**
 * The authentication gate (BR-01).
 *
 * One middleware, applied once to the whole API surface, rather than a check
 * in each handler that somebody can forget. The acting coordinator is taken
 * from the session - never from the request body - so a client cannot change
 * who it is by editing a payload.
 */
export function requireAuth(sessions, clock) {
  return (req, res, next) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const session = sessions.get(token, clock.now());

    if (!session) {
      return next(
        new AppError('unauthenticated', 'Sign in to continue.', { status: 401 }),
      );
    }

    req.session = session;
    req.coordinatorId = session.coordinatorId;
    next();
  };
}
