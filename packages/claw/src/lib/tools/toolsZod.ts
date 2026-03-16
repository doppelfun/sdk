import { z } from "zod/v4";

export const approachPositionSchema = z.object({
  position: z.string().describe('Block-local coordinates "x,z" or "x,y,z" (0–100).'),
  sprint: z.boolean().optional(),
});

export const approachPersonSchema = z.object({
  sessionId: z.string().describe("Occupant clientId from get_occupants."),
  sprint: z.boolean().optional(),
});

export const stopSchema = z.object({
  jump: z.boolean().optional(),
});

export const chatSchema = z.object({
  text: z.string().describe("Message text (max 500 chars)"),
  targetSessionId: z.string().optional().describe("Recipient session id for DM."),
  voiceId: z.string().optional(),
});

export const getOccupantsSchema = z.object({});

export function getToolSchema(name: string): z.ZodTypeAny | undefined {
  return CLAW_TOOL_REGISTRY.find((t) => t.name === name)?.schema;
}

export const CLAW_TOOL_REGISTRY: Array<{
  name: string;
  description: string;
  schema: z.ZodTypeAny;
}> = [
  {
    name: "approach_position",
    description: "Move to block-local coordinates (0–100). Pass position as 'x,z'. Only owner can give movement commands.",
    schema: approachPositionSchema,
  },
  {
    name: "approach_person",
    description: "Move to a person's position. Pass sessionId (clientId from get_occupants). Only owner can give movement commands.",
    schema: approachPersonSchema,
  },
  {
    name: "stop",
    description: "Stop moving.",
    schema: stopSchema,
  },
  {
    name: "chat",
    description: "Send chat. Omit targetSessionId for global; set for DM so only you two see it.",
    schema: chatSchema,
  },
  {
    name: "get_occupants",
    description: "List everyone currently in the block.",
    schema: getOccupantsSchema,
  },
];
