/**
 * Vertex AI (ADC / gcloud auth).
 *
 * - @google/genai with `{ vertexai: true, project, location }` → build + intent.
 * - @ai-sdk/google-vertex with same project/location → chat tick.
 *
 * Vertex provider instance is cached; createVertex is reused per getChatModel.
 */

import { GoogleGenAI } from "@google/genai";
import { createVertex, type GoogleVertexProvider } from "@ai-sdk/google-vertex";
import type { LanguageModel } from "ai";
import type { ClawConfig } from "../../config/config.js";
import { GoogleGenAiProviderBase } from "./googleGenAiBase.js";

export function resolveVertexProjectLocation(config: ClawConfig): {
  project: string;
  location: string;
} {
  const project = config.googleCloudProject || process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = config.googleCloudLocation || process.env.GOOGLE_CLOUD_LOCATION?.trim();
  if (!project || !location) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION required when LLM_PROVIDER=google-vertex"
    );
  }
  return { project, location };
}

function toLanguageModel(vertex: GoogleVertexProvider, modelId: string): LanguageModel {
  return vertex(modelId) as unknown as LanguageModel;
}

export class GoogleGenAiVertexProvider extends GoogleGenAiProviderBase {
  private readonly chatProvider: GoogleVertexProvider;

  constructor(config: ClawConfig) {
    const { project, location } = resolveVertexProjectLocation(config);
    super(new GoogleGenAI({ vertexai: true, project, location }));
    this.chatProvider = createVertex({ project, location });
  }

  getChatModel(modelId: string): LanguageModel {
    return toLanguageModel(this.chatProvider, modelId);
  }
}
