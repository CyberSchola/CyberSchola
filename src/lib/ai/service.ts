import { z } from "zod";
import type { AiChatResult } from "./types";
import { getAiProvider } from "./provider";

export const aiChatRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "message is required")
    .max(4000, "message is too long"),
});

export class AiServiceError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function runAiChat(rawInput: unknown): Promise<AiChatResult> {
  const parsed = aiChatRequestSchema.safeParse(rawInput);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Invalid request";
    throw new AiServiceError("INVALID_REQUEST", firstIssue, 400);
  }

  try {
    const provider = getAiProvider();
    const reply = await provider.generateReply(parsed.data.message);
    return { message: reply };
  } catch (error) {
    console.error("Raw provider error:", error);
    if (error instanceof Error && error.message === "GROQ_API_KEY is not configured") {
      throw new AiServiceError(
        "AI_NOT_CONFIGURED",
        "AI service is not configured",
        500
      );
    }

    throw new AiServiceError(
      "AI_PROVIDER_ERROR",
      "The AI provider failed to generate a response",
      502
    );
  }
}