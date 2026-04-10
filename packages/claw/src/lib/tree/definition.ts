/**
 * Mistreevous behaviour tree definition (MDSL).
 *
 * Root: sequence of ExecuteMovementAndDrain then a selector over wake branches.
 * Selector order (priority): owner wake (obedient) → autonomous wake → time-based wake → clear idle.
 *
 * Autonomous branch (when HasAutonomousWake && OwnerAwayOrInConversation): decision layer drives flow.
 * OwnerAwayOrInConversation is also true during an active companion skill run so observe-mode owners
 * in-range do not block social seek / wander for that run.
 * - InConversation && CanReplyInConversation → RunConverseAgent (chat-only LLM; only when we received a message and can send).
 * - InConversation && WaitingForReply → ContinueWaiting (no-op; avoid spinning LLM while waiting for peer reply).
 * - WasConverseButNowIdle → ExitConversationToWander.
 * - HasApproachGoal → ContinueApproach (no-op; movement driver handles pathing).
 * - ShouldSeekSocialTarget → SeekSocialTarget (set target + moveTo); else SetWanderGoal + TryMoveToNearestOccupant.
 *
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
                condition [OwnerAwayOrInConversation]
                selector {
                    sequence {
                        condition [InConversation]
                        condition [CanReplyInConversation]
                        condition [HasEnoughCredits]
                        action [RunConverseAgent]
                    }
                    sequence {
                        condition [InConversation]
                        condition [WaitingForReply]
                        action [ContinueWaiting]
                    }
                    sequence {
                        condition [WasConverseButNowIdle]
                        action [ExitConversationToWander]
                    }
                    sequence {
                        condition [HasApproachGoal]
                        action [ContinueApproach]
                    }
                    sequence {
                        condition [ShouldSeekSocialTarget]
                        condition [HasEnoughCredits]
                        action [SeekSocialTarget]
                    }
                    sequence {
                        action [SetWanderGoal]
                        action [TryMoveToNearestOccupant]
                    }
                }
            }
            sequence {
                condition [HasAutonomousWake]
                condition [OwnerAwayOrInConversation]
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
