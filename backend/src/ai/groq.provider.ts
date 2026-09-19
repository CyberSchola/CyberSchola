import { Inject, Injectable, Logger } from '@nestjs/common';
import type Groq from 'groq-sdk';

import { AiProviderException } from './ai-provider.exception';
import type { AiGenerationRequest, AiGenerationResult, AiProvider } from './ai-provider.interface';
import { GROQ_CLIENT } from './groq.constants';

@Injectable()
export class GroqProvider implements AiProvider {
  private readonly logger = new Logger('GroqProvider');
  private readonly model = 'openai/gpt-oss-120b';

  constructor(@Inject(GROQ_CLIENT) private readonly client: Groq) {}

  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 500,
        messages: [{ role: 'user', content: request.message }],
      });

      const reply = completion.choices[0]?.message?.content;
      if (!reply) {
        throw new Error('Groq returned an empty response');
      }

      return { message: reply, finishReason: 'stop', model: this.model };
    } catch (error) {
      this.logger.error(
        `Groq request failed [requestId=${request.context.requestId}]`,
        error instanceof Error ? error.stack : error,
      );
      throw new AiProviderException();
    }
  }
}