export const AI_PROVIDER = Symbol('AI_PROVIDER');

/**
 * Trusted, server-derived context for one AI request. Built only from the
 * already-verified backend RequestContext (see ai-context.ts) — never from
 * client input. ai.chat gates reaching the model; it is not a stand-in for
 * future capability-specific permissions (data retrieval, tools, etc).
 */
export interface AiRequestContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
  readonly requestId: string;
}

export interface AiGenerationRequest {
  readonly message: string;
  readonly context: AiRequestContext;
}

export interface AiGenerationResult {
  readonly message: string;
  readonly finishReason?: 'stop' | 'length' | 'content_filter' | 'error';
  readonly model?: string;
}

export interface AiProvider {
  generate(request: AiGenerationRequest): Promise<AiGenerationResult>;
}
