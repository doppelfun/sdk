/**
 * Mistreevous behaviour tree definition (MDSL).
 *
 * Root: sequence of ExecuteMovementAndDrain then a selector over wake branches.
 * Selector order (priority): owner wake (obedient) → autonomous wake → time-based wake → clear idle.
 * Autonomous branch: if CanRunAutonomousLlm run LLM; else if NotInConversation run TryMoveToNearestOccupant (no LLM).
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
                    sequence {
                        condition [NotInConversation]
                        action [TryMoveToNearestOccupant]
                    }
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
