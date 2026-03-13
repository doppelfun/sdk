/** End the current agent-to-agent DM conversation (FSM → idle). Lets the agent wander or talk to others. */
import type { ToolContext } from "../types.js";
import { clearConversation } from "../../conversation/index.js";

export async function handleEndConversation(ctx: ToolContext) {
  const { state, logAction } = ctx;
  clearConversation(state);
  logAction("end_conversation: left conversation");
  return { ok: true, summary: "conversation ended" };
}
