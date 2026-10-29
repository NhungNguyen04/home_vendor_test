/**
 * The five onboarding stages.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGES,
  STAGE_STATES,
  TERMINAL_STAGE,
  isValidStage,
  isTerminal,
  stageIndex,
  stageStateFor,
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

// --------------------------------------------------------------- the states

test('there is one state object per stage, in workflow order', () => {
  assert.equal(STAGE_STATES.length, 5);
  assert.deepEqual(
    STAGE_STATES.map((stage) => stage.name),
    STAGES,
  );

  STAGE_STATES.forEach((stage, index) => {
    assert.equal(stage.index, index);
    assert.equal(stageIndex(stage.name), index);
  });
});

test('a stage knows its own name and whether it is the end of the line', () => {
  for (const stage of STAGE_STATES) {
    assert.equal(isTerminal(stage.name), stage.isTerminal);
  }

  const terminal = STAGE_STATES.filter((stage) => stage.isTerminal);
  assert.deepEqual(
    terminal.map((stage) => stage.name),
    [TERMINAL_STAGE],
  );
});

test('a stage state cannot be found for something that is not a stage', () => {
  assert.equal(stageStateFor('Cancelled'), undefined);
  assert.equal(stageStateFor('KYC'), undefined);
});

test('every stage may move to every other stage', () => {
  // The rule today: transitions are not constrained to be sequential, so a
  // coordinator may fix a wrongly-entered stage.
  for (const from of STAGE_STATES) {
    assert.deepEqual(from.allowedTargets, STAGES);

    for (const to of STAGE_STATES) {
      assert.equal(from.judgeMove(to).allowed, true, `${from.name} -> ${to.name}`);
    }
  }
});

test('a move to an earlier stage is backward, and needs a reason', () => {
  const move = stageStateFor('KYC Verified').judgeMove(stageStateFor('Contract Signed'));

  assert.equal(move.direction, 'backward');
  assert.equal(move.requiresReason, true);
  assert.equal(move.allowed, true);
});

test('a move to a later stage is forward, and needs no reason', () => {
  const move = stageStateFor('Contract Sent').judgeMove(stageStateFor('KYC Verified'));

  assert.equal(move.direction, 'forward');
  assert.equal(move.requiresReason, false);
  assert.equal(move.allowed, true);
});

test('a move to the same stage is neither forward nor backward', () => {
  const move = stageStateFor('KYC Verified').judgeMove(stageStateFor('KYC Verified'));

  assert.equal(move.direction, 'same');
  assert.equal(move.requiresReason, false);
});
