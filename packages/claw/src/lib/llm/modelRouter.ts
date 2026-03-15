/**
 * Model router: use a cheap LLM call to choose Pro (tools/build) vs Flash (conversation).
 *
 * When CLAW_MODEL_ROUTER=1 we run a single generateText with chatLlmModel (Flash) to classify
 * the user message as TOOLS or CONVERSATION, then return the LanguageModel for the tick:
 * - TOOLS → buildLlmModel (e.g. Gemini Pro for tool calling / building)
 * - CONVERSATION → chatLlmModel (e.g. Gemini Flash for replies)
 *
 * This uses the AI SDK only (generateText); no provider-specific APIs.
 */

import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { ClawConfig } from "../config/index.js";
import { createLlmProvider } from "./provider.js";
import { clawDebug } from "../log.js";

const ROUTER_PROMPT = `You classify whether the user message requires the agent to USE TOOLS (move, build, chat, get_occupants, list_catalog, join_block, etc.) or is just a CONVERSATION (greeting, question, chitchat). "Go to X,Y", "head to 37,30", "move there" = TOOLS. Reply with exactly one word: TOOLS or CONVERSATION.

User message:
`;

/** Heuristic: message looks like a movement request → use Pro so approach_position/approach_person is reliably called. */
function looksLikeMoveRequest(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /\b(go|head|walk|move)\s+(to|toward)?\s*[\d.,]+\s*[,]\s*[\d.]+\b/.test(t) ||
    /\b(go|head|walk|move)\s+to\s+[\d.,]+\s*[\d.]*\b/.test(t) ||
    /\b(move|go|head|walk)\s+to\s+(the\s+)?(pyramid|city|target|there)\b/.test(t)
  );
}

/** Classify with Flash (chatLlmModel), then return Pro or Flash model for the main tick. */
export async function getTickModelForMessage(
  config: ClawConfig,
  userContent: string
): Promise<LanguageModel | null> {
  const provider = createLlmProvider(config);
  const flashModel = provider.getChatModel(config.chatLlmModel);
  const proModel = provider.getChatModel(config.buildLlmModel);
  if (!flashModel || !proModel) return flashModel ?? proModel ?? null;

  const trimmed = userContent.trim().slice(0, 800);
  if (!trimmed) return provider.getChatModel(config.chatLlmModel);

  if (looksLikeMoveRequest(trimmed)) {
    clawDebug("model router", "Pro (move request heuristic)");
    return proModel;
  }

  try {
    const result = await generateText({
      model: flashModel,
      prompt: ROUTER_PROMPT + trimmed,
      maxOutputTokens: 8,
      temperature: 0,
    });
    const word = (result.text ?? "").trim().toUpperCase();
    const usePro = word.includes("TOOLS");
    clawDebug("model router", usePro ? "Pro (tools)" : "Flash (conversation)", "raw:", word.slice(0, 20));
    return usePro ? proModel : flashModel;
  } catch {
    clawDebug("model router failed, using chat model");
    return flashModel;
  }
}
