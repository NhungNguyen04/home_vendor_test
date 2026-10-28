/**
 * Changing a vendor's stage.
 *
 * This is the write path, so it is where the business rules live: who changed
 * it, when, from which stage to which stage, and what happens when two
 * coordinators touch the same vendor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestContext, signIn, NOW } from './helpers.js';
import { changeStage } from '../src/services/stage-service.js';

async function loadVendor(agent, id) {
  const response = await agent.get(`/api/vendors/${id}`);
  assert.equal(response.status, 200);
  return response.body.vendor;
}

test('a stage change records the move, the actor and the time', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app, 'linh@company.vn');
  const vendor = await loadVendor(agent, 3); // Company C, Contract Signed

  const response = await agent
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Docs Received', expectedVersion: vendor.version });

  assert.equal(response.status, 200);
  assert.equal(response.body.changed, true);
  assert.equal(response.body.vendor.stage, 'KYC Docs Received');
  assert.equal(response.body.historyEntry.previousStage, 'Contract Signed');
  assert.equal(response.body.historyEntry.newStage, 'KYC Docs Received');
  assert.deepEqual(response.body.historyEntry.changedBy, { id: 1, name: 'Linh' });
  assert.equal(response.body.historyEntry.changedAt, new Date(NOW).toISOString());
});

test('the time in stage restarts when the stage changes', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);
  const vendor = await loadVendor(agent, 3);

  const response = await agent
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Docs Received', expectedVersion: vendor.version });

  assert.equal(response.body.vendor.stageEnteredAt, new Date(NOW).toISOString());
  assert.equal(response.body.vendor.daysInStage, 0);
  assert.equal(response.body.vendor.durationMs, 0);
  assert.equal(response.body.vendor.isStuck, false);
});

test('the version moves on by one', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);
  const vendor = await loadVendor(agent, 3);

  const response = await agent
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Docs Received', expectedVersion: vendor.version });

  assert.equal(response.body.vendor.version, vendor.version + 1);
});

test('the change shows up in the history', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);
  const vendor = await loadVendor(agent, 3);

  await agent
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Docs Received', expectedVersion: vendor.version });

  const history = await agent.get('/api/vendors/3/history');
  assert.equal(history.body.history.length, 2);
  assert.equal(history.body.history[0].newStage, 'KYC Docs Received');
  assert.equal(history.body.history[0].changedBy.name, 'Linh');
});

test('a chain of moves records each hop', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  let vendor = await loadVendor(agent, 3); // Contract Signed
  let response = await agent
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Docs Received', expectedVersion: vendor.version });
  assert.equal(response.status, 200);

  vendor = response.body.vendor;
  response = await agent
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Verified', expectedVersion: vendor.version });
  assert.equal(response.status, 200);

  const history = await agent.get('/api/vendors/3/history');
  const [latest, previous, original] = history.body.history;

  assert.equal(latest.previousStage, 'KYC Docs Received');
  assert.equal(latest.newStage, 'KYC Verified');
  assert.equal(previous.previousStage, 'Contract Signed');
  assert.equal(previous.newStage, 'KYC Docs Received');
  assert.equal(original.previousStage, 'Contract Sent');
  assert.equal(original.newStage, 'Contract Signed');
});

test('submitting the stage the vendor is already in changes nothing', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);
  const vendor = await loadVendor(agent, 3); // Contract Signed

  const response = await agent
    .patch('/api/vendors/3/stage')
    .send({ stage: 'Contract Signed', expectedVersion: vendor.version });

  assert.equal(response.status, 200);
  assert.equal(response.body.changed, false);
  assert.equal(response.body.vendor.version, vendor.version);

  const history = await agent.get('/api/vendors/3/history');
  assert.equal(history.body.history.length, 1);
});

test('a stale version is rejected and nothing is written', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);
  const vendor = await loadVendor(agent, 3);

  const response = await agent
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Docs Received', expectedVersion: vendor.version + 5 });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'version_conflict');

  const after = await loadVendor(agent, 3);
  assert.equal(after.stage, 'Contract Signed');
  assert.equal(after.version, vendor.version);

  const history = await agent.get('/api/vendors/3/history');
  assert.equal(history.body.history.length, 1);
});

test('the conflict names the stage the vendor is actually in', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);
  const vendor = await loadVendor(agent, 3);

  const response = await agent
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Docs Received', expectedVersion: vendor.version + 5 });

  assert.equal(response.body.error.details.currentStage, 'Contract Signed');
  assert.equal(response.body.error.details.currentVersion, vendor.version);
  assert.match(response.body.error.message, /Contract Signed/);
});

test('two coordinators updating the same vendor: the second one is refused', async () => {
  const { app } = createTestContext();
  const linh = await signIn(app, 'linh@company.vn');
  const huy = await signIn(app, 'huy@company.vn');

  // Both coordinators are looking at the same version of the vendor.
  const asSeenByLinh = await loadVendor(linh, 3);
  const asSeenByHuy = await loadVendor(huy, 3);
  assert.equal(asSeenByLinh.version, asSeenByHuy.version);

  const linhChange = await linh
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Docs Received', expectedVersion: asSeenByLinh.version });
  assert.equal(linhChange.status, 200);

  // Huy submits against the version he is still holding.
  const huyChange = await huy
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Verified', expectedVersion: asSeenByHuy.version });
  assert.equal(huyChange.status, 409);

  // The vendor holds Linh's stage, and the history records exactly one change.
  const vendor = await loadVendor(huy, 3);
  assert.equal(vendor.stage, 'KYC Docs Received');
  assert.equal(vendor.version, asSeenByLinh.version + 1);

  const history = await huy.get('/api/vendors/3/history');
  assert.equal(history.body.history.length, 2);
  assert.equal(history.body.history[0].changedBy.name, 'Linh');
  assert.equal(history.body.history[0].newStage, 'KYC Docs Received');
});

test('an invalid stage is rejected', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);
  const vendor = await loadVendor(agent, 3);

  const response = await agent
    .patch('/api/vendors/3/stage')
    .send({ stage: 'Cancelled', expectedVersion: vendor.version });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'invalid_request');
  assert.deepEqual(response.body.error.details.allowed, [
    'Contract Sent',
    'Contract Signed',
    'KYC Docs Received',
    'KYC Verified',
    'Active',
  ]);
});

test('a missing stage is rejected', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.patch('/api/vendors/3/stage').send({});

  assert.equal(response.status, 400);
  assert.equal(response.body.error.details.field, 'stage');
});

test('a missing version is rejected', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.patch('/api/vendors/3/stage').send({ stage: 'KYC Verified' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.details.field, 'expectedVersion');
});

test('a version that is not a whole number is rejected', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Verified', expectedVersion: '2' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.details.field, 'expectedVersion');
});

test('an unknown vendor is a 404', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent
    .patch('/api/vendors/9999/stage')
    .send({ stage: 'KYC Verified', expectedVersion: 1 });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'not_found');
});

test('the change is attributed to the coordinator who is signed in', async () => {
  const { app } = createTestContext();
  const huy = await signIn(app, 'huy@company.vn');
  const vendor = await loadVendor(huy, 3);

  const response = await huy
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Docs Received', expectedVersion: vendor.version });

  assert.deepEqual(response.body.historyEntry.changedBy, { id: 2, name: 'Huy' });
});

test('reading the tracker never moves a vendor on by itself', async () => {
  // BR-07: a vendor whose KYC verification failed stays where it is. Nothing
  // in the read path may advance a stage.
  const { app, statements } = createTestContext();
  const agent = await signIn(app);

  const before = statements.getVendor.get(2); // Company B, KYC Docs Received
  await agent.get('/api/vendors');
  await agent.get('/api/vendors/2');
  await agent.get('/api/vendors/2/history');

  const after = statements.getVendor.get(2);
  assert.equal(after.stage, before.stage);
  assert.equal(after.stage_entered_at, before.stage_entered_at);
  assert.equal(after.version, before.version);
});

test('a failed history write leaves the vendor exactly as it was', () => {
  // The vendor update and the history insert are one transaction, so a
  // failure in either one undoes both.
  const { db, statements, now } = createTestContext();

  const before = statements.getVendor.get(3);
  const historyBefore = statements.countHistory.get().count;

  assert.throws(
    () =>
      changeStage(db, statements, {
        vendorId: 3,
        newStage: 'KYC Docs Received',
        actorId: 9999, // no such coordinator - the history insert will fail
        expectedVersion: before.version,
        now,
      }),
    /FOREIGN KEY constraint failed/i,
  );

  const after = statements.getVendor.get(3);
  assert.equal(after.stage, before.stage);
  assert.equal(after.version, before.version);
  assert.equal(after.stage_entered_at, before.stage_entered_at);
  assert.equal(statements.countHistory.get().count, historyBefore);
});

test('the version in the WHERE clause is the real guard', () => {
  // The service checks the version before it writes, but the write itself
  // carries the version, so a change that lands on a stale view updates
  // nothing even if the pre-check were to be bypassed.
  const { db, statements, now } = createTestContext();

  const before = statements.getVendor.get(3);

  // Somebody else moves the vendor between the read and the write.
  statements.updateVendorStage.run('KYC Docs Received', now, 3, before.version);

  const result = changeStage(db, statements, {
    vendorId: 3,
    newStage: 'KYC Verified',
    actorId: 1,
    expectedVersion: before.version,
    now,
  });

  assert.equal(result.kind, 'stale');
  assert.equal(statements.getVendor.get(3).stage, 'KYC Docs Received');
  assert.equal(statements.countHistory.get().count, 12); // only the seeded rows
});
