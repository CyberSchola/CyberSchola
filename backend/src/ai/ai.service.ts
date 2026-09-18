import { Inject, Injectable } from '@nestjs/common';

import { AI_PROVIDER, type AiProvider } from './ai-provider.interface';
import { AiUsageService } from './ai-usage.service';

/**
 * The AI Gateway boundary for AI-02.
 *
 * Every AI request passes through here after authentication, tenant
 * resolution and permission checks (all handled by the global pipeline
 * before this is ever called). This service enforces usage limiting before
 * any provider call and is the only place AI_PROVIDER is invoked.
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    private readonly usage: AiUsageService,
  ) {}

  async chat(tenantId: string, userId: string, message: string): Promise<string> {
    await this.usage.checkAndRecord(tenantId, userId);
    return this.provider.generateReply(message);
  }
}