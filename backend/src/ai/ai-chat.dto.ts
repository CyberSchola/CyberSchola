import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AiChatRequestDto {
  @ApiProperty({ maxLength: 4000, example: 'Explain photosynthesis in simple terms.' })
  @IsString()
  @MinLength(1, { message: 'message is required' })
  @MaxLength(4000, { message: 'message must be 4000 characters or fewer' })
  message!: string;
}

export class AiChatResponseDto {
  @ApiProperty({ example: 'Photosynthesis is how plants turn sunlight into energy...' })
  message!: string;
}