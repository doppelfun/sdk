# Agent-to-Agent Conversation Module — Plan

## Goal

Replace the current cooldown/queue spread across state, chat handler, agent, and movement driver with a single **ConversationModule** that:

1. Enforces **turn-taking**: you cannot send another DM to the peer until you receive a response (no `chat_sent`-based send cooldown).
2. Applies a **receive delay** (optional) so we don’t start replying before their TTS finishes (using `audioDurationMs` from the chat payload when present).
3. Supports **conversation end/break** so the agent isn’t stuck waiting forever.

The module will implement an explicit **finite state machine** for the current agent–agent conversation.

---

## 1. FSM States

| State               | Meaning |
|---------------------|--------|
| `idle`              | No active DM conversation with another agent (or conversation ended). |
| `can_reply`         | We received a DM from a peer; we are allowed to send one reply. A short receive delay may still be in effect (TTS finish). |
| `waiting_for_reply` | We sent a DM to the peer; we must wait for them to reply before we can send again. |

---

## 2. Transitions

| From               | Event | To |
|--------------------|-------|-----|
| `idle`             | Received DM from peer (we are recipient) | `can_reply` |
| `can_reply`        | We send a DM to that peer               | `waiting_for_reply` |
| `waiting_for_reply`| Received DM from that peer              | `can_reply` |
| `waiting_for_reply`| **Break** (timeout, peer left, owner message, join_block, etc.) | `idle` |
| `can_reply`        | **Break** (same conditions)             | `idle` |

---

## 3. Conversation “Break” Conditions (transition to `idle`)

**Reactive breaks** (things that happen to us; we transition to `idle` when we detect them):

- **Peer left**: Peer no longer in `state.occupants` (or no longer in same block). Check when occupants are updated or in a periodic check.
- **Timeout**: We’ve been in `waiting_for_reply` longer than `CONVERSATION_TIMEOUT_MS` (e.g. 45–60s). Check in the same place we’d drain `pendingDmReply` (e.g. 50ms loop or once per tick).
- **Owner message**: User (owner) sent a message (global or DM to us). Clear conversation so the agent can respond to the owner.
- **Join block**: Already clear on `join_block`; conversation module state reset there.
- **Global message from peer** (optional): If the peer sends to global, treat as “left the thread” and clear.

**Agent-initiated break** (how the agent can end the conversation occasionally to avoid endless chat loops):

- **Explicit “end conversation” tool**: Expose a tool (e.g. `end_conversation`) that the LLM can call when it decides the conversation is over (e.g. natural wrap-up, topic exhausted, or “I’m done”). The tool calls `clearConversation(state)` and transitions to `idle`. The agent can then wander, seek others, or do something else. System prompt should encourage the agent to occasionally wrap up and end conversations rather than replying forever.
- **Turn or round limit** (optional): After N full exchanges (e.g. we sent → they replied → we replied, repeated N times), the module could force or suggest a break: e.g. set a flag `conversationRoundCount` and in `checkBreak` (or when we receive a reply) if `conversationRoundCount >= CONVERSATION_MAX_ROUNDS` (e.g. 5–10), transition to `idle` (and optionally clear so the next exchange is “new”). This gives a hard cap so even if the LLM never calls `end_conversation`, we eventually break.
- **Prompt / behavior**: In the system prompt, instruct the agent that it can and should sometimes end conversations (say goodbye, then the agent can use the `end_conversation` tool or we rely on turn limit). Without this, the LLM may never call the tool.

Recommendation: implement at least the **tool** and **prompt** so the agent can voluntarily break; add a **turn limit** as a safety net so we always break after N rounds even if the LLM doesn’t.

---

## 4. Module API (ConversationModule / lib)

**Location:** `packages/claw/src/lib/conversation/` (e.g. `conversation.ts` and optionally `conversationState.ts` for types).

**State owned by the module (or stored in ClawState and updated only via the module):**

- `conversationState: 'idle' | 'can_reply' | 'waiting_for_reply'`
- `conversationPeerSessionId: string | null`
- `receiveDelayUntil: number` (0 or timestamp until we’re allowed to send, from TTS duration)
- `waitingForReplySince: number` (timestamp when we entered `waiting_for_reply`, for timeout)
- `pendingDmReply: { text: string; targetSessionId: string } | null` (optional; if we keep queue when in receive delay)
- **`conversationRoundCount: number`** (optional): number of full exchanges with the current peer; incremented when we receive a DM from peer (or when we send). Used for optional turn limit: when `conversationRoundCount >= CONVERSATION_MAX_ROUNDS`, `checkBreak` can force transition to `idle`.

**Public API (functions or small class):**

- **`canSendDmTo(state, sessionId): boolean`**  
  True if we’re allowed to send a DM to `sessionId`: state is `can_reply` and peer matches and (optional) `receiveDelayUntil` has passed; or state is `idle` (new conversation). If state is `waiting_for_reply` and peer matches, return false.

- **`onWeSentDm(state, targetSessionId)`**  
  Transition to `waiting_for_reply`; set `conversationPeerSessionId = targetSessionId`, `waitingForReplySince = now`. Clear any receive delay.

- **`onWeReceivedDm(state, fromSessionId, audioDurationMs?: number, messageLength?: number)`**  
  If we’re the recipient: transition to `can_reply`; set peer; set `receiveDelayUntil = now + RECEIVE_REPLY_DELAY_MIN_MS + (audioDurationMs ?? estimate from messageLength)`. If using round limit, increment `conversationRoundCount` when we receive a DM from the current peer. If fromSessionId is not current peer, could treat as new conversation (or ignore if we want strict 1:1).

- **`checkBreak(state, now, options): void`**  
  Options: `occupants`, `ownerUserId`, `lastTriggerUserId` (owner just spoke?), `blockSlotId`, and optionally `maxRounds` (CONVERSATION_MAX_ROUNDS). If timeout, peer not in occupants, owner message, or (optional) round count ≥ maxRounds, transition to `idle` and clear peer / timers. Call from 50ms loop or after occupant updates.

- **`clearConversation(state)`**  
  Force transition to `idle`; clear peer and timers. Call on join_block, from break logic, and from the **`end_conversation`** tool when the agent chooses to leave the conversation.

- **`drainPendingReply(state): { text, targetSessionId } | null`**  
  If we have a queued reply and we’re now allowed to send (e.g. receive delay passed and we’re in `can_reply`), return it and clear the queue. Call from 50ms loop.

- **`getConversationPeer(state): string | null`**  
  Return `conversationPeerSessionId` (for prompts and for “reply in thread” targetSessionId). Can replace or alias `lastDmPeerSessionId` for agent–agent purposes.

---

## 5. What Gets Replaced / Simplified

- **Remove from ClawState (or move under conversation module):**  
  `agentChatCooldownUntil`, `pendingDmReply`, and the “send cooldown” / “receive delay” logic that’s spread across state helpers. Optionally keep `lastDmPeerSessionId` as the “current DM peer” for prompts and reply target, or have the module own it for agent–agent and set it from `conversationPeerSessionId`.

- **Remove:**  
  `chat_sent` handler that sets send cooldown (no more “speak again after duration”); send cooldown is “can’t speak until you receive a response.”

- **Keep (or move into module):**  
  Receive delay (so we don’t reply over their TTS): implemented as `receiveDelayUntil` and checked in `canSendDmTo` and when draining pending reply.

- **Chat handler:**  
  Before sending a DM, call `canSendDmTo(state, targetSessionId)`. If false, queue in `pendingDmReply` (or return “wait for reply” to the LLM). After sending, call `onWeSentDm(state, targetSessionId)`.

- **Agent onMessage("chat"):**  
  When we receive a DM (we’re recipient), call `onWeReceivedDm(state, fromSessionId, audioDurationMs, message.length)`. On owner message or global, call `checkBreak` or `clearConversation` as appropriate.

- **50ms loop:**  
  Call `checkBreak(state, now, { occupants, ... })`; then `drainPendingReply(state)` and if non-null, send the reply and call `onWeSentDm`.

- **join_block:**  
  Call `clearConversation(state)` (and clear any conversation-owned state).

- **AutonomousManager / movement driver:**  
  When considering “go talk to another agent,” respect conversation state (e.g. don’t start a new conversation if we’re in `waiting_for_reply` with someone; optional). When sending the autonomous greeting, call `onWeSentDm` after send.

---

## 6. Constants

- **`CONVERSATION_TIMEOUT_MS`** (e.g. 45_000–60_000): after this long in `waiting_for_reply`, transition to `idle`.
- **`CONVERSATION_MAX_ROUNDS`** (optional, e.g. 5–10): max full exchanges with the same peer before forcing a break to `idle`; prevents endless loops if the agent never calls `end_conversation`.
- **`RECEIVE_REPLY_DELAY_MIN_MS`**: keep from state or move into conversation module.
- **`TTS_CHARS_PER_SECOND`** (or use `audioDurationMs` from payload only): for estimating receive delay when `audioDurationMs` is missing.

---

## 7. File Layout

```
packages/claw/src/lib/conversation/
  PLAN.md           (this file)
  types.ts          (ConversationState, ConversationPhase, options for checkBreak)
  conversation.ts   (FSM state, transitions, canSendDmTo, onWeSentDm, onWeReceivedDm, checkBreak, clearConversation, drainPendingReply)
  index.ts          (re-exports)
```

State can live in ClawState (e.g. `conversationPhase`, `conversationPeerSessionId`, `receiveDelayUntil`, `waitingForReplySince`, `pendingDmReply`) and be updated only via the conversation module so the FSM is the single place that mutates them.

---

## 8. Implementation Order

1. **Add conversation types and state fields** to ClawState (or a small ConversationState slice).
2. **Implement conversation.ts**: FSM transitions, `canSendDmTo`, `onWeSentDm`, `onWeReceivedDm`, `checkBreak`, `clearConversation`, `drainPendingReply`.
3. **Wire chat handler**: use `canSendDmTo`; on send call `onWeSentDm`; on cooldown/block queue reply.
4. **Wire agent.ts**: on receive DM call `onWeReceivedDm`; on owner/global call `checkBreak` or clear; remove `chat_sent` send-cooldown handling; in 50ms loop call `checkBreak` and `drainPendingReply`.
5. **Wire join_block**: `clearConversation`.
6. **Wire AutonomousManager / movement driver**: optional “don’t seek new conversation if waiting_for_reply”; after autonomous greeting send call `onWeSentDm`.
7. **Remove** old cooldown helpers from state (or keep only what the conversation module uses internally).
8. **Agent-initiated break**: Add **`end_conversation`** tool that calls `clearConversation(state)`; add to system prompt that the agent can and should occasionally end conversations (say goodbye, then end). Optionally add `conversationRoundCount` and in `checkBreak` force break when `conversationRoundCount >= CONVERSATION_MAX_ROUNDS`.
9. **Tests**: unit tests for FSM transitions and `canSendDmTo`; integration test that sending a DM blocks until reply or break; test that `end_conversation` and (if implemented) round limit transition to `idle`.

---

## 9. Optional Extensions

- **Peer sent global**: in `checkBreak`, if we have “last message was from peer and was global,” transition to `idle`.
- **Logging**: log state transitions (idle → can_reply, can_reply → waiting_for_reply, break reasons) for debugging.
