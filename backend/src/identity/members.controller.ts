import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { Permission } from '../auth/permission.matrix';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { ApiSuccessResponseDto } from '../common/dto/api-response.dto';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { MembersService, type MemberSummary } from './members.service';

/** Largest page anyone may request. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

export class ListMembersQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: `limit must be between 1 and ${MAX_LIMIT}` })
  // Capped rather than merely defaulted. A default only helps callers who omit
  // it; a cap is what stops one asking for every member of the largest school
  // in a single query.
  @Max(MAX_LIMIT, { message: `limit must be between 1 and ${MAX_LIMIT}` })
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset must be zero or greater' })
  offset?: number;
}

export class MemberDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'The Supabase subject for this person.' })
  userId!: string;

  @ApiProperty({ enum: ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF'] })
  role!: string;

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  status!: string;
}

export class MemberPageDto {
  @ApiProperty({ type: [MemberDto] })
  items!: MemberDto[];

  @ApiProperty({
    example: 42,
    description:
      'Total members visible to this caller, under the same access scope as the page itself.',
  })
  total!: number;

  @ApiProperty({ example: 25 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}

class MemberPageResponseDto extends ApiSuccessResponseDto<MemberPageDto> {
  @ApiProperty({ type: MemberPageDto })
  declare data: MemberPageDto;
}

/**
 * The people in the school the caller is acting in.
 *
 * Tenant-scoped, so it is not `@TenantOptional()`: a school has to be resolved
 * before the question means anything.
 *
 * Every role holds `MembershipRead`, so the permission check admits all of
 * them. What differs is how much they see, and that is the access scope on the
 * action rather than anything this controller decides. Keeping the two apart is
 * the point: the alternative is either denying teachers the endpoint or handing
 * them the whole school.
 */
@ApiTags('Identity')
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequiresPermission(Permission.MembershipRead)
  @ApiOperation({
    summary: 'Members of the current school',
    description:
      'A school administrator sees everyone. Every other role sees only their own membership. ' +
      'The total reflects the same scope as the page, so it cannot be used to learn how many ' +
      'members exist beyond what the caller may see.',
  })
  @ApiOkResponse({ type: MemberPageResponseDto })
  @ResponseMessage('Members retrieved.')
  async list(@Query() query: ListMembersQueryDto): Promise<MemberPageDto> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const page = await this.members.list(limit, offset);

    return {
      items: page.items.map(toDto),
      total: page.total,
      limit,
      offset,
    };
  }
}

/**
 * Only the fields a caller needs.
 *
 * Deliberately not the entity. Returning rows straight from the database is how
 * a column added later, for an internal reason, quietly becomes part of the
 * public API.
 */
function toDto(member: MemberSummary): MemberDto {
  return {
    id: member.id,
    userId: member.userId,
    role: member.role,
    status: member.status,
  };
}
