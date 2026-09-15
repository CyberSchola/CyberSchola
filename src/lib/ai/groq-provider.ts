import Groq from "groq-sdk";
import type { AiProvider } from "./types";
import { getGroqApiKey, AI_CONFIG } from "./config";

export function createGroqProvider(): AiProvider {
  const client = new Groq({
    apiKey: getGroqApiKey(),
  });

  return {
    async generateReply(message: string): Promise<string> {
      const completion = await client.chat.completions.create({
        model: AI_CONFIG.groqModel,
        max_tokens: AI_CONFIG.maxOutputTokens,
        messages: [
          {
            role: "user",
            content: message,
          },
        ],
      });

      const reply = completion.choices[0]?.message?.content;

      if (!reply) {
        throw new Error("Groq returned an empty response");
      }

      return reply;
    },
  };
}