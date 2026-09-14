import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MeController } from './me.controller';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { Membership } from './membership.entity';
import { MembershipService } from './membership.service';

/**
 * The caller's own view of their memberships.
 *
 * Small on purpose. It exists so that a signed-in person who belongs to more
 * than one school can discover which schools those are, which is what makes
 * the school selector usable. Without it a client would have to be told its
 * school ids out of band, and the selector would be unusable in practice.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Membership])],
  controllers: [MeController, MembersController],
  providers: [MembershipService, MembersService],
  exports: [MembershipService, MembersService],
})
export class IdentityModule {}
