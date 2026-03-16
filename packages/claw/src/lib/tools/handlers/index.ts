import type { ToolHandler } from "../types.js";
import { handleApproachPosition, handleApproachPerson, handleStop } from "./move.js";
import { handleChat } from "./chat.js";
import { handleGetOccupants } from "./occupants.js";

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  approach_position: handleApproachPosition,
  approach_person: handleApproachPerson,
  stop: handleStop,
  chat: handleChat,
  get_occupants: handleGetOccupants,
};
