export function getGroqApiKey(): string {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  return apiKey;
}

export const AI_CONFIG = {
  groqModel: "openai/gpt-oss-120b",
  maxOutputTokens: 500,
} as const;