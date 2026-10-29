import express from 'express';
import { AppError } from './errors.js';
import { requireAuth, SESSION_COOKIE } from './auth-middleware.js';
import { STAGES } from '../domain/stages.js';
import { changeStage, toVendorDto, toHistoryDto } from '../services/stage-service.js';
import { toIso } from '../clock.js';

export function createRouter({ db, statements, sessions, clock, config }) {
  const router = express.Router();

  const vendorDto = (vendor) =>
    toVendorDto(vendor, { now: clock.now(), thresholdDays: config.stuckThresholdDays });

  // ---------------------------------------------------------------- login

  router.post('/login', (req, res) => {
    const { email, password } = req.body ?? {};

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new AppError('invalid_request', 'Enter an email address and a password.');
    }

    const result = sessions.login(statements, { email, password });

    // The same code and message whether the account is unknown or the
    // password is wrong, so the endpoint cannot be used to discover which
    // email addresses have accounts.
    if (result.kind === 'invalid_credentials') {
      throw new AppError('invalid_credentials', 'That email address or password is not right.', {
        status: 401,
      });
    }

    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: config.sessionTtlMs,
    });

    res.json({ coordinator: result.coordinator });
  });

  router.post('/logout', requireAuth(sessions, clock), (req, res) => {
    const token = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim().split('='))
      .find(([key]) => key === SESSION_COOKIE)?.[1];
    if (token) sessions.logout(decodeURIComponent(token));

    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth(sessions, clock), (req, res) => {
    const coordinator = statements.getCoordinator.get(req.coordinatorId);
    if (!coordinator) {
      throw new AppError('unauthenticated', 'Sign in to continue.', { status: 401 });
    }
    res.json({
      coordinator: {
        id: coordinator.id,
        name: coordinator.name,
        email: coordinator.email,
      },
    });
  });

  // -------------------------------------------------------------- vendors

  router.get('/vendors', requireAuth(sessions, clock), (req, res) => {
    const now = clock.now();
    const vendors = statements.listVendors.all().map((vendor) => vendorDto(vendor));

    res.json({
      vendors,
      stages: STAGES,
      stuckThresholdDays: config.stuckThresholdDays,
      asOf: toIso(now),
      clockFrozen: clock.isFrozen(),
    });
  });

  router.get('/vendors/:id', requireAuth(sessions, clock), (req, res) => {
    const vendor = statements.getVendor.get(parseVendorId(req.params.id));
    if (!vendor) {
      throw new AppError('not_found', 'That vendor does not exist.', { status: 404 });
    }
    res.json({ vendor: vendorDto(vendor) });
  });

  router.get('/vendors/:id/history', requireAuth(sessions, clock), (req, res) => {
    const vendorId = parseVendorId(req.params.id);
    const vendor = statements.getVendor.get(vendorId);
    if (!vendor) {
      throw new AppError('not_found', 'That vendor does not exist.', { status: 404 });
    }

    const history = statements.listHistory.all(vendorId).map(toHistoryDto);
    res.json({ vendorId, history });
  });

  router.patch('/vendors/:id/stage', requireAuth(sessions, clock), (req, res) => {
    const vendorId = parseVendorId(req.params.id);
    const { stage, expectedVersion, reason } = req.body ?? {};

    if (typeof stage !== 'string' || !stage) {
      throw new AppError('invalid_request', 'A stage is required.', {
        details: { field: 'stage' },
      });
    }

    if (!Number.isInteger(expectedVersion)) {
      throw new AppError('invalid_request', 'The version you are updating is missing or invalid.', {
        details: { field: 'expectedVersion' },
      });
    }

    if (reason !== undefined && typeof reason !== 'string') {
      throw new AppError('invalid_request', 'The reason must be text.', {
        details: { field: 'reason' },
      });
    }

    const result = changeStage(db, statements, {
      vendorId,
      newStage: stage,
      actorId: req.coordinatorId,
      expectedVersion,
      reason,
      now: clock.now(),
    });

    if (result.kind === 'not_found') {
      throw new AppError('not_found', 'That vendor does not exist.', { status: 404 });
    }

    if (result.kind === 'invalid_stage') {
      throw new AppError('invalid_request', `"${stage}" is not one of the onboarding stages.`, {
        details: { field: 'stage', allowed: STAGES },
      });
    }

    if (result.kind === 'invalid_transition') {
      throw new AppError(
        'invalid_request',
        `A vendor cannot move from ${result.from} to ${result.to}.`,
        {
          details: {
            field: 'stage',
            from: result.from,
            to: result.to,
            allowed: result.allowed,
          },
        },
      );
    }

    if (result.kind === 'reason_required') {
      throw new AppError(
        'invalid_request',
        `Moving ${result.vendor.name} back from ${result.from} to ${result.to} needs a reason.`,
        {
          details: { field: 'reason', from: result.from, to: result.to },
        },
      );
    }

    if (result.kind === 'stale') {
      // The write is rejected outright, so the history stays a faithful log of
      // what actually happened.
      throw new AppError(
        'version_conflict',
        `${result.vendor.name} was moved to ${result.vendor.stage} by someone else. Your change was not applied.`,
        {
          status: 409,
          details: {
            currentStage: result.vendor.stage,
            currentVersion: result.vendor.version,
            currentStageEnteredAt: toIso(result.vendor.stage_entered_at),
            vendor: vendorDto(result.vendor),
          },
        },
      );
    }

    if (result.kind === 'unchanged') {
      res.json({ changed: false, vendor: vendorDto(result.vendor) });
      return;
    }

    const historyEntry = statements.listHistory
      .all(vendorId)
      .find((entry) => entry.id === result.historyId);

    res.json({
      changed: true,
      vendor: vendorDto(result.vendor),
      historyEntry: historyEntry ? toHistoryDto(historyEntry) : null,
    });
  });

  return router;
}

/** A non-numeric id is a vendor that does not exist, not a server error. */
function parseVendorId(raw) {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : -1;
}
