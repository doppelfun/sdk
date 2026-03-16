/**
 * Mistreevous behaviour tree definition (MDSL).
 * Root: sequence of ExecuteMovementAndDrain then selector over wake branches.
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
                condition [HasEnoughCredits]
                action [RunAutonomousAgent]
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
