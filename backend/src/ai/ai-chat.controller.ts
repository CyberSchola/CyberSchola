import { Body, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '../auth/permission.matrix';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { SYSTEM_MESSAGES } from '../constants/system.messages';
import { AiChatRequestDto, AiChatResponseDto } from './ai-chat.dto';
import { resolveAiRequestContext } from './ai-context';
import { AiService } from './ai.service';

/**
 * Generic AI chat only. Permission.AiChat gates reaching the model — it must
 * not become the authorization mechanism for data retrieval, tools, or
 * role-specific capabilities; those get their own permissions when built.
 */
@ApiTags('AI')
@Controller('ai/chat')
export class AiChatController {
  constructor(private readonly aiService: AiService) {}

  @Post()
  @RequiresPermission(Permission.AiChat)
  @ResponseMessage(SYSTEM_MESSAGES.SUCCESS)
  @ApiOperation({
    summary: 'Send a message to the AI assistant.',
    description:
      'Identity, tenant and role come only from the authenticated request context. ' +
      'Any tenantId, userId, role, or copilot field in the body is rejected by the ' +
      'global validation pipe, which whitelists only the fields this DTO declares.',
  })
  @ApiOkResponse({ type: AiChatResponseDto })
  async chat(@Body() body: AiChatRequestDto): Promise<AiChatResponseDto> {
    const context = resolveAiRequestContext();
    const reply = await this.aiService.chat(context, body.message);
    return { message: reply };
  }
}