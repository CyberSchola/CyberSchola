import { Module } from '@nestjs/common';
import Groq from 'groq-sdk';

import { AiChatController } from './ai-chat.controller';
import { AI_PROVIDER } from './ai-provider.interface';
import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { GROQ_CLIENT } from './groq.constants';
import { GroqProvider } from './groq.provider';

@Module({
  controllers: [AiChatController],
  providers: [
    AiService,
    AiUsageService,
    {
      provide: GROQ_CLIENT,
      useFactory: () => new Groq({ apiKey: process.env.GROQ_API_KEY }),
    },
    { provide: AI_PROVIDER, useClass: GroqProvider },
  ],
})
export class AiModule {}
