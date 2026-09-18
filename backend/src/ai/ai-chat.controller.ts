import { Body, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '../auth/permission.matrix';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { SYSTEM_MESSAGES } from '../constants/system.messages';
import { requireTenantId, requireUserId } from '../tenancy/request-context';
import { AiChatRequestDto, AiChatResponseDto } from './ai-chat.dto';
import { AiService } from './ai.service';

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
      'Identity, school and role are taken from the authenticated request context only. ' +
      'Any tenantId, role or userId sent in the request body is rejected by the global ' +
      'validation pipe, which whitelists only the fields this DTO declares.',
  })
  @ApiOkResponse({ type: AiChatResponseDto })
  async chat(@Body() body: AiChatRequestDto): Promise<AiChatResponseDto> {
    const tenantId = requireTenantId();
    const userId = requireUserId();
    const reply = await this.aiService.chat(tenantId, userId, body.message);
    return { message: reply };
  }
}