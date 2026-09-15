import type { AiProvider } from "./types";
import { createGroqProvider } from "./groq-provider";

let cachedProvider: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (!cachedProvider) {
    cachedProvider = createGroqProvider();
  }

  return cachedProvider;
}