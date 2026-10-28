/**
 * The five onboarding stages.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGES,
  TERMINAL_STAGE,
  isValidStage,
  isTerminal,
  stageIndex,
} from '../src/domain/stages.js';

test('there are exactly five stages, in workflow order', () => {
  assert.deepEqual(STAGES, [
    'Contract Sent',
    'Contract Signed',
    'KYC Docs Received',
    'KYC Verified',
    'Active',
  ]);
});

test('every stage validates', () => {
  for (const stage of STAGES) {
    assert.equal(isValidStage(stage), true, `${stage} should be valid`);
  }
});

test('anything else does not validate', () => {
  for (const value of ['', 'active', 'ACTIVE', 'KYC', 'Cancelled', null, undefined, 42]) {
    assert.equal(isValidStage(value), false, `${String(value)} should not be valid`);
  }
});

test('Active is the terminal stage', () => {
  assert.equal(TERMINAL_STAGE, 'Active');
  assert.equal(isTerminal('Active'), true);
  assert.equal(isTerminal('KYC Verified'), false);
});

test('stageIndex gives the workflow position, or -1', () => {
  assert.equal(stageIndex('Contract Sent'), 0);
  assert.equal(stageIndex('Active'), 4);
  assert.equal(stageIndex('Cancelled'), -1);
});
