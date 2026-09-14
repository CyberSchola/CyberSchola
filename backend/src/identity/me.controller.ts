import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

import { ApiSuccessResponseDto } from '../common/dto/api-response.dto';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { requireUserId } from '../tenancy/request-context';
import { TenantOptional } from '../tenancy/tenant-optional.decorator';
import { MembershipService, type SchoolMembership } from './membership.service';

export class SchoolMembershipDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Greenfield Academy' })
  name!: string;

  @ApiProperty({ example: 'greenfield-academy' })
  slug!: string;

  @ApiProperty({ enum: ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF'] })
  role!: string;
}

class SchoolMembershipsResponseDto extends ApiSuccessResponseDto<SchoolMembershipDto[]> {
  @ApiProperty({ type: [SchoolMembershipDto] })
  declare data: SchoolMembershipDto[];
}

/**
 * What the caller is, rather than what a school contains.
 *
 * This is the route that makes `@Public()` and `@TenantOptional()` worth
 * keeping as separate decorators. It is **authenticated but tenantless**: you
 * must prove who you are, and the whole point is that you have not chosen a
 * school yet. A single "anonymous" marker could not express that, and the
 * workaround would be to mark it public, which would hand anyone a way to read
 * a person's school memberships by guessing a user id.
 */
@ApiTags('Identity')
@TenantOptional()
@Controller('me')
export class MeController {
  constructor(private readonly memberships: MembershipService) {}

  @Get('schools')
  @ApiOperation({
    summary: 'Schools the signed-in user belongs to',
    description:
      'Returns the schools this account has a live membership of. A client with more than ' +
      'one sends the chosen id in the X-School-Id header on subsequent requests. The header ' +
      'selects from this list and cannot name anything outside it.',
  })
  @ApiOkResponse({ type: SchoolMembershipsResponseDto })
  @ResponseMessage('Schools retrieved.')
  async schools(): Promise<SchoolMembership[]> {
    // From the request context, not from a parameter or a query string. There
    // is no call shape here that lets a caller ask about somebody else.
    return this.memberships.schoolsFor(requireUserId());
  }
}
