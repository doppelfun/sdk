/**
 * Build subagent: one-shot LLM agent with build-only tools.
 *
 * Invoked by the Obedient agent via the run_build tool. Flow:
 * 1. Asks user: premade (city/pyramid) or custom?
 * 2. Premade → generate_procedural; custom → build_full or build_with_code (then build_incremental to add).
 * 3. Uses list_catalog, list_documents, get_document_content, delete_* as needed.
 *
 * Stops after first build/delete tool call (stopWhen) or after 10 steps. Context is carried
 * across run_build invocations via store.buildSubagentContext so multi-turn "what to build" works.
 */
import { ToolLoopAgent, stepCountIs, hasToolCall } from "ai";
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../../../state/index.js";
import type { ClawConfig } from "../../../config/index.js";
import { resolveBuildLanguageModel } from "../../../llm/toolsAi.js";
import type { AgentLike } from "../../shared/runAgentTick.js";
import { buildBuildToolSet } from "./buildToolSet.js";

const BUILD_INSTRUCTIONS = `You are a build agent. The user will ask to build something.

If there is "Previous build conversation" in the prompt, use it to continue.
Otherwise start by asking: "Do you want a premade or a custom build?"

- Premade: use list_catalog to see catalog ids, then call generate_procedural with kind "city" or "pyramid". You can pass params (e.g. rows, cols, blockSize for city).
- Custom (normal): use list_catalog then build_full with an instruction describing the scene. Use build_incremental to add to an existing document (documentTarget append, or documentId from list_documents).
- Custom (using code): when the user asks to build "using code", "with code", "programmatic", "with Python", "generate with code", or similar, use build_with_code with an instruction. build_with_code runs in a Python sandbox and can produce complex/algorithmic MML. If build_with_code returns an error (e.g. "requires Google Gemini"), fall back to build_full and say you used the standard builder instead.
- list_documents shows existing document UUIDs for replace/append/delete.
- get_document_content reads back MML after a build.
- delete_document: pass documentId or target current|last. delete_all_documents: removes every document in the block.

After running a build or delete tool, always reply with one short sentence for the user describing what you made (e.g. "I built a large pond with water and rocks in the corner." or "I added a fountain to the scene."). Do not just repeat the tool message; tell the user what is now in the world. Then stop.`;

/** Creates the Build subagent (model + tools + instructions). Used by createRunBuildTool. */
export function createBuildSubagent(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  onToolResult?: (name: string, args: string, result: unknown) => void
): AgentLike {
  const model = resolveBuildLanguageModel(config);
  if (!model) throw new Error("No build model: set BUILD_LLM_MODEL (e.g. for OpenRouter).");

  const tools = buildBuildToolSet(client, store, config, (name, args, res) => {
    onToolResult?.(name, typeof args === "string" ? args : JSON.stringify(args), res);
  });

  return new ToolLoopAgent({
    model,
    instructions: BUILD_INSTRUCTIONS,
    tools,
    stopWhen: [
      stepCountIs(10),
      hasToolCall("generate_procedural"),
      hasToolCall("build_full"),
      hasToolCall("build_incremental"),
      hasToolCall("build_with_code"),
      hasToolCall("delete_document"),
      hasToolCall("delete_all_documents"),
    ],
    maxOutputTokens: 1024,
    temperature: 0.2,
  }) as unknown as AgentLike;
}
