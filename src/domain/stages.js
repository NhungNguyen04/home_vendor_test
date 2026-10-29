/**
 * The five onboarding stages, in workflow order - and the rules each of them
 * owns.
 *
 * This is the State pattern applied to the stage lifecycle. Every stage is an
 * object that knows where it sits in the workflow, whether it is the end of
 * the line, and how it judges a proposed move to another stage. The write path
 * asks the current stage to judge the move instead of testing stage names
 * against a list of conditionals.
 *
 * The order is documentation only: the application deliberately does not
 * enforce sequential transitions (see main-design.md, "Concurrency and
 * assumptions"). A coordinator may move a vendor between any two stages. What
 * the stages do own is the difference between the two kinds of move - forward
 * is progress, backward is rework, and rework has to be explained.
 */

/** The stage definitions, in workflow order. The order is load-bearing. */
const STAGE_DEFINITIONS = [
  { name: 'Contract Sent' },
  { name: 'Contract Signed' },
  { name: 'KYC Docs Received' },
  { name: 'KYC Verified' },
  { name: 'Active', isTerminal: true },
];

/**
 * Build one stage state.
 *
 * `allowedTargets` is the extension point. Today every stage allows a move to
 * every other stage, so the set is derived rather than written out. When a
 * stage gains a rule of its own - "you may not leave this stage until the
 * licence is approved" - that rule is added here, on the stage it belongs to,
 * and nowhere else.
 */
function defineStage({ name, index, isTerminal = false, allowedTargets }) {
  const targets = allowedTargets ?? STAGE_DEFINITIONS.map((definition) => definition.name);

  return Object.freeze({
    name,
    index,
    isTerminal,
    allowedTargets: Object.freeze([...targets]),

    /**
     * Judge a proposed move from this stage to `target`.
     *
     * @param {object} target the state object of the stage being moved to
     * @returns {{ allowed: boolean, direction: 'forward'|'backward'|'same', requiresReason: boolean }}
     */
    judgeMove(target) {
      const direction =
        target.index > this.index ? 'forward' : target.index < this.index ? 'backward' : 'same';

      return {
        allowed: this.allowedTargets.includes(target.name),
        direction,
        // Moving a vendor back is rework, so the coordinator has to say why.
        // The rule sits beside the direction it belongs to, so it has one home.
        requiresReason: direction === 'backward',
      };
    },
  });
}

/** The five stage states, in workflow order. */
export const STAGE_STATES = Object.freeze(
  STAGE_DEFINITIONS.map((definition, index) => defineStage({ ...definition, index })),
);

const STAGE_BY_NAME = new Map(STAGE_STATES.map((stage) => [stage.name, stage]));

/** The stage names, in workflow order. */
export const STAGES = STAGE_STATES.map((stage) => stage.name);

/** The stage a vendor sits in once onboarding is finished. */
export const TERMINAL_STAGE = STAGE_STATES.find((stage) => stage.isTerminal).name;

/** The state object for a stage name, or undefined when it is not a stage. */
export function stageStateFor(stage) {
  return STAGE_BY_NAME.get(stage);
}

export function isValidStage(stage) {
  return STAGE_BY_NAME.has(stage);
}

export function isTerminal(stage) {
  return STAGE_BY_NAME.get(stage)?.isTerminal ?? false;
}

/** Position of a stage in the workflow, or -1 when it is not a stage. */
export function stageIndex(stage) {
  return STAGE_BY_NAME.get(stage)?.index ?? -1;
}
