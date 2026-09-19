import { Inject, Injectable } from '@nestjs/common';

import { AI_PROVIDER, type AiProvider, type AiRequestContext } from './ai-provider.interface';
import { AiUsageService } from './ai-usage.service';

/**
 * The AI Gateway boundary. Quota is enforced before the provider is ever
 * called; the provider is reached only through AI_PROVIDER, never imported
 * directly by anything else.
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    private readonly usage: AiUsageService,
  ) {}

  async chat(context: AiRequestContext, message: string): Promise<string> {
    await this.usage.checkAndRecord(context.tenantId, context.userId);
    const result = await this.provider.generate({ message, context });
    return result.message;
  }
}