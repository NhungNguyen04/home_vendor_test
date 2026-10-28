/**
 * The five onboarding stages, in workflow order.
 *
 * The order is documentation only: the application deliberately does not
 * enforce sequential transitions (see main-design.md, "Concurrency and
 * assumptions"). A coordinator may move a vendor between any two stages.
 */
export const STAGES = [
  'Contract Sent',
  'Contract Signed',
  'KYC Docs Received',
  'KYC Verified',
  'Active',
];

/** The stage a vendor sits in once onboarding is finished. */
export const TERMINAL_STAGE = 'Active';

export function isValidStage(stage) {
  return STAGES.includes(stage);
}

export function isTerminal(stage) {
  return stage === TERMINAL_STAGE;
}

/** Position of a stage in the workflow, or -1 when it is not a stage. */
export function stageIndex(stage) {
  return STAGES.indexOf(stage);
}
