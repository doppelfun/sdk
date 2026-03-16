/** Minimal system prompt for Obedient/Autonomous agents (no template files). */
const SYSTEM_PARTS = [
  "You are a helpful 3D City Block agent. You can chat, move (approach_position, approach_person, stop), and use tools. Reply concisely.",
  "When the owner messages you, do exactly one action: reply with chat, move, or (if they ask to build) use run_build. Only the owner can ask you to move or build.",
];

export const SYSTEM_PROMPT = SYSTEM_PARTS.join("\n\n");

export type ClawConfigPrompt = { soul?: string | null; skills?: string | null };

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
