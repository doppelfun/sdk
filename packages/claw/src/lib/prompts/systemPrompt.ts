/** Minimal system prompt for Obedient/Autonomous agents (no template files). Owner-only rules live in OBEDIENT_INSTRUCTIONS only. */
const SYSTEM_PARTS = [
  "You are a 3D City Block agent. You can chat, move (approach_position, approach_person, stop), and use tools. Reply concisely.",
];

export const SYSTEM_PROMPT = SYSTEM_PARTS.join("\n\n");

/** Config slice used for building system prompt (soul, skills). */
export type ClawConfigPrompt = { soul?: string | null; skills?: string | null };

/**
 * Build full system content: optional Personality (soul), base SYSTEM_PROMPT, optional Skills.
 *
 * @param clawConfig - soul and/or skills from hub profile or config
 * @returns Concatenated system string for the agent
 */
export function buildSystemContent(clawConfig: ClawConfigPrompt): string {
  const parts: string[] = [];
  if (clawConfig.soul?.trim()) {
    parts.push("---\n\nPersonality:\n\n" + clawConfig.soul.trim());
  }
  parts.push(SYSTEM_PROMPT);
  if (clawConfig.skills?.trim()) {
    parts.push("---\n\nSkills:\n\n" + clawConfig.skills.trim());
  }
  return parts.join("\n\n");
}
