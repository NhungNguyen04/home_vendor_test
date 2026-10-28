/**
 * Authentication.
 *
 * The rules under test are the ones the brief states: only a signed-in
 * coordinator may use the tracker (BR-01), the acting coordinator comes from
 * the session rather than from anything the client sends, and the login
 * endpoint does not reveal which email addresses have accounts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestContext, signIn, DEMO_PASSWORD } from './helpers.js';

test('the vendor list is closed to anonymous callers', async () => {
  const { app } = createTestContext();

  const response = await request(app).get('/api/vendors');

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'unauthenticated');
});

test('a stage change is closed to anonymous callers', async () => {
  const { app } = createTestContext();

  const response = await request(app)
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Docs Received', expectedVersion: 2 });

  assert.equal(response.status, 401);
});

test('a wrong password is rejected', async () => {
  const { app } = createTestContext();

  const response = await request(app)
    .post('/api/login')
    .send({ email: 'linh@company.vn', password: 'not-the-password' });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'invalid_credentials');
});

test('an unknown account is rejected in exactly the same way', async () => {
  const { app } = createTestContext();

  const wrongPassword = await request(app)
    .post('/api/login')
    .send({ email: 'linh@company.vn', password: 'not-the-password' });
  const unknownAccount = await request(app)
    .post('/api/login')
    .send({ email: 'nobody@company.vn', password: 'not-the-password' });

  assert.equal(unknownAccount.status, wrongPassword.status);
  assert.equal(unknownAccount.body.error.code, wrongPassword.body.error.code);
  assert.equal(unknownAccount.body.error.message, wrongPassword.body.error.message);
});

test('a valid sign-in returns the coordinator and sets a session cookie', async () => {
  const { app } = createTestContext();

  const response = await request(app)
    .post('/api/login')
    .send({ email: 'linh@company.vn', password: DEMO_PASSWORD });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.coordinator, {
    id: 1,
    name: 'Linh',
    email: 'linh@company.vn',
  });

  const cookie = response.headers['set-cookie'][0];
  assert.match(cookie, /^session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});

test('the sign-in response never contains a password', async () => {
  const { app } = createTestContext();

  const response = await request(app)
    .post('/api/login')
    .send({ email: 'linh@company.vn', password: DEMO_PASSWORD });

  const serialised = JSON.stringify(response.body);
  assert.ok(!serialised.includes('password'));
  assert.ok(!serialised.includes('hash'));
  assert.ok(!serialised.includes(DEMO_PASSWORD));
});

test('the email address is matched case-insensitively', async () => {
  const { app } = createTestContext();

  const response = await request(app)
    .post('/api/login')
    .send({ email: '  LINH@company.vn ', password: DEMO_PASSWORD });

  assert.equal(response.status, 200);
  assert.equal(response.body.coordinator.email, 'linh@company.vn');
});

test('a missing email or password is a bad request, not a wrong password', async () => {
  const { app } = createTestContext();

  const response = await request(app).post('/api/login').send({});

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'invalid_request');
});

test('a malformed JSON body is a bad request', async () => {
  const { app } = createTestContext();

  const response = await request(app)
    .post('/api/login')
    .set('Content-Type', 'application/json')
    .send('{"email": "linh@company.vn",');

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'invalid_request');
});

test('the signed-in coordinator can be read back', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  const response = await agent.get('/api/me');

  assert.equal(response.status, 200);
  assert.equal(response.body.coordinator.email, 'linh@company.vn');
});

test('signing out invalidates the session', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app);

  assert.equal((await agent.get('/api/me')).status, 200);

  const logout = await agent.post('/api/logout');
  assert.equal(logout.status, 204);

  const after = await agent.get('/api/me');
  assert.equal(after.status, 401);
});

test('two coordinators hold independent sessions', async () => {
  const { app } = createTestContext();

  const linh = await signIn(app, 'linh@company.vn');
  const huy = await signIn(app, 'huy@company.vn');

  const linhMe = await linh.get('/api/me');
  const huyMe = await huy.get('/api/me');

  assert.equal(linhMe.body.coordinator.email, 'linh@company.vn');
  assert.equal(huyMe.body.coordinator.email, 'huy@company.vn');

  // One coordinator signing out must not sign the other one out.
  await linh.post('/api/logout');
  assert.equal((await huy.get('/api/me')).status, 200);
});

test('the acting coordinator comes from the session, not from the request body', async () => {
  const { app } = createTestContext();
  const agent = await signIn(app, 'linh@company.vn');

  const response = await agent
    .patch('/api/vendors/3/stage')
    .send({ stage: 'KYC Docs Received', expectedVersion: 2, changedBy: 3, actorId: 3 });

  assert.equal(response.status, 200);
  assert.equal(response.body.historyEntry.changedBy.name, 'Linh');
});

test('a forged session cookie is rejected', async () => {
  const { app } = createTestContext();

  const response = await request(app)
    .get('/api/vendors')
    .set('Cookie', 'session=not-a-real-token');

  assert.equal(response.status, 401);
});

test('an expired session is rejected', async () => {
  const { app, sessions } = createTestContext();

  const login = await request(app)
    .post('/api/login')
    .send({ email: 'linh@company.vn', password: DEMO_PASSWORD });
  const token = login.headers['set-cookie'][0].split(';')[0].split('=')[1];

  // The session store stamps the session with the wall clock when it is
  // created, so the expiry is exercised by reading it back past the TTL.
  assert.equal(sessions.get(token, Date.now() + 2 * 60 * 60 * 1000), null);

  const response = await request(app).get('/api/me').set('Cookie', `session=${token}`);
  assert.equal(response.status, 401);
});
