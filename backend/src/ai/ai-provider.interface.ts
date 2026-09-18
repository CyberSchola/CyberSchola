export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface AiProvider {
  generateReply(message: string): Promise<string>;
}