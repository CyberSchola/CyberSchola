import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Result } from './result.entity';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

/** Assessment results and the performance read the Admin Copilot builds on. */
@Module({
  imports: [TypeOrmModule.forFeature([Result])],
  controllers: [ResultsController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class ResultsModule {}
