import { Injectable, Logger } from '@nestjs/common';
import Groq from 'groq-sdk';

import type { AiProvider } from './ai-provider.interface';

/**
 * Groq implementation of AiProvider.
 *
 * GROQ_API_KEY is validated at boot by env.validation.ts, not here, so a
 * missing key fails startup rather than the first request. This constructor
 * reads process.env directly because Nest providers do not receive the
 * validated EnvironmentVariables instance without a ConfigService injection,
 * and boot has already guaranteed the value is present and non-blank.
 */
@Injectable()
export class GroqProvider implements AiProvider {
  private readonly logger = new Logger('GroqProvider');
  private readonly client: Groq;
  private readonly model = 'openai/gpt-oss-120b';

  constructor() {
    this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  async generateReply(message: string): Promise<string> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 500,
        messages: [{ role: 'user', content: message }],
      });
      const reply = completion.choices[0]?.message?.content;
      if (!reply) {
        throw new Error('Groq returned an empty response');
      }
      return reply;
    } catch (error) {
      this.logger.error('Groq request failed', error instanceof Error ? error.stack : error);
      throw error;
    }
  }
}