import path from 'node:path';
import express from 'express';
import { createRouter } from './http/routes.js';
import { errorHandler, notFoundHandler } from './http/errors.js';

/**
 * Build the express application.
 *
 * Takes its collaborators as arguments rather than importing them, so a test
 * can hand it an in-memory database and a fixed clock.
 */
export function createApp({ db, statements, sessions, clock, config }) {
  const app = express();

  app.use(express.json({ limit: '100kb' }));

  app.use('/api', createRouter({ db, statements, sessions, clock, config }));

  // Unknown API routes stay JSON 404s rather than falling through to the page.
  app.use('/api', notFoundHandler);

  app.use(express.static(config.publicDir));

  // The single-page fallback. The API prefix is excluded so that a mistyped
  // endpoint answers with a JSON 404 instead of a page of HTML.
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use(errorHandler);

  return app;
}
