/**
 * Mistreevous behaviour tree definition (MDSL).
 * Root: sequence of ExecuteMovementAndDrain then selector over wake branches.
 * Autonomous branch: if CanRunAutonomousLlm (real DM or cooldown elapsed) run LLM; else TryMoveToNearestOccupant (no LLM).
 * @see docs/PLAN-AGENT-WAKE-DRIVEN.md §6
 */

export const TREE_DEFINITION = `root {
    sequence {
        action [ExecuteMovementAndDrain]
        selector {
            sequence {
                condition [HasOwnerWake]
                condition [HasEnoughCredits]
                action [RunObedientAgent]
            }
            sequence {
                condition [HasOwnerWake]
                condition [InsufficientCredits]
                action [ClearWakeInsufficientCredits]
            }
            sequence {
                condition [HasAutonomousWake]
                selector {
                    sequence {
                        condition [CanRunAutonomousLlm]
                        condition [HasEnoughCredits]
                        action [RunAutonomousAgent]
                    }
                    action [TryMoveToNearestOccupant]
                }
            }
            sequence {
                condition [HasAutonomousWake]
                condition [InsufficientCredits]
                action [ClearWakeInsufficientCredits]
            }
            sequence {
                condition [TimeForAutonomousWake]
                action [RequestAutonomousWake]
            }
            action [ClearWakeIdle]
        }
    }
}`;
