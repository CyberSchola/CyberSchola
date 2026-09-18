import { Module } from '@nestjs/common';

import { AiChatController } from './ai-chat.controller';
import { AI_PROVIDER } from './ai-provider.interface';
import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { GroqProvider } from './groq.provider';

@Module({
  controllers: [AiChatController],
  providers: [AiService, AiUsageService, { provide: AI_PROVIDER, useClass: GroqProvider }],
})
export class AiModule {}