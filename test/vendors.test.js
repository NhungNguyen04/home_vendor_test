/**
 * Reading vendors and their history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestContext, signIn, NOW } from './helpers.js';

test('the vendor list reports the threshold and the instant it was measured at', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors');

  assert.equal(response.status, 200);
  assert.equal(response.body.stuckThresholdDays, 7);
  assert.equal(response.body.asOf, new Date(NOW).toISOString());
  assert.equal(response.body.clockFrozen, true);
  assert.deepEqual(response.body.stages, [
    'Contract Sent',
    'Contract Signed',
    'KYC Docs Received',
    'KYC Verified',
    'Active',
  ]);
});

test('the vendor list contains every seeded vendor, ordered by name', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors');

  assert.equal(response.body.vendors.length, 12);
  assert.deepEqual(
    response.body.vendors.map((v) => v.name),
    [...Array(12)].map((_, i) => `Company ${String.fromCharCode(65 + i)}`),
  );
});

test('a vendor carries everything a coordinator needs to judge it', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors/2');

  assert.equal(response.status, 200);
  const vendor = response.body.vendor;
  assert.equal(vendor.id, 2);
  assert.equal(vendor.name, 'Company B');
  assert.equal(vendor.region, 'Can Tho');
  assert.equal(vendor.stage, 'KYC Docs Received');
  assert.equal(vendor.stageEnteredAtKnown, true);
  assert.equal(vendor.daysInStage, 24);
  assert.equal(vendor.durationMs, 24 * 24 * 60 * 60 * 1000);
  assert.equal(vendor.durationLabel, '24d 0h');
  assert.equal(vendor.isStuck, true);
  assert.equal(vendor.isTerminal, false);
  assert.deepEqual(vendor.owner, { id: 2, name: 'Huy' });
  assert.equal(vendor.notes, 'Waiting on business license re-upload');
  assert.equal(typeof vendor.version, 'number');
});

test('a vendor waiting past the threshold is flagged as stuck', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors');

  const byName = Object.fromEntries(response.body.vendors.map((v) => [v.name, v]));
  assert.equal(byName['Company B'].isStuck, true); // 24 days
  assert.equal(byName['Company F'].isStuck, true); // 12 days
  assert.equal(byName['Company I'].isStuck, true); // 8 days
  assert.equal(byName['Company J'].isStuck, true); // 7 days + 1 ms
  assert.equal(byName['Company K'].isStuck, true); // 7 days 23:59:59.999
});

test('a vendor sitting exactly on the threshold is not flagged', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors');

  const companyE = response.body.vendors.find((v) => v.name === 'Company E');
  assert.equal(companyE.daysInStage, 7);
  assert.equal(companyE.isStuck, false);
});

test('a vendor with no stage-entry time is neither stuck nor not stuck', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors/8');

  const vendor = response.body.vendor;
  assert.equal(vendor.stageEnteredAt, null);
  assert.equal(vendor.stageEnteredAtKnown, false);
  assert.equal(vendor.durationMs, null);
  assert.equal(vendor.daysInStage, null);
  assert.equal(vendor.durationLabel, 'Unknown');
  assert.equal(vendor.isStuck, null);
});

test('a vendor in the terminal stage is not flagged however long it has been there', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors/1');

  assert.equal(response.body.vendor.stage, 'Active');
  assert.equal(response.body.vendor.daysInStage, 90);
  assert.equal(response.body.vendor.isTerminal, true);
  assert.equal(response.body.vendor.isStuck, false);
});

test('a vendor reports who changed it last', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors/2');

  assert.deepEqual(response.body.vendor.lastChange, {
    previousStage: 'Contract Signed',
    newStage: 'KYC Docs Received',
    changedBy: { id: 2, name: 'Huy' },
    changedAt: new Date(NOW - 24 * 24 * 60 * 60 * 1000).toISOString(),
  });
});

test('a vendor with no history reports no last change', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors/8');

  assert.equal(response.body.vendor.lastChange, null);
});

test('the history of a vendor is newest first', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors/2/history');

  assert.equal(response.status, 200);
  assert.equal(response.body.vendorId, 2);
  assert.equal(response.body.history.length, 2);
  assert.equal(response.body.history[0].newStage, 'KYC Docs Received');
  assert.equal(response.body.history[1].newStage, 'Contract Signed');
  assert.ok(
    Date.parse(response.body.history[0].changedAt) >
      Date.parse(response.body.history[1].changedAt),
  );
});

test('a history entry names the coordinator who made it', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors/2/history');

  assert.deepEqual(response.body.history[0].changedBy, { id: 2, name: 'Huy' });
});

test('a vendor with no history returns an empty list, not an error', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors/8/history');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.history, []);
});

test('an unknown vendor id is a 404', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors/9999');

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'not_found');
});

test('a vendor id that is not a number is a 404, not a server error', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/vendors/abc');

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'not_found');
});

test('an unknown API endpoint is a JSON 404, not the web page', async () => {
  const { app } = createTestContext();

  const response = await request(app).get('/api/nothing-here');

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'not_found');
});
