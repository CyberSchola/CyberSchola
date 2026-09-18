import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TimetableLesson } from './entities/timetable-lesson.entity';
import { TimetablePeriod } from './entities/timetable-period.entity';
import { MyTimetableController, TimetableController } from './timetable.controller';
import { TimetableService } from './timetable.service';

/**
 * Class timetables, blueprint Phase 6.
 *
 * Reads the academic spine and the people records it builds on through their
 * tables, and owns only periods and lessons. The clash finder in
 * `timetable-clashes.ts` is a plain function, so the academics module can name
 * a clash when a class subject changes teacher without importing this module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TimetablePeriod, TimetableLesson])],
  controllers: [TimetableController, MyTimetableController],
  providers: [TimetableService],
})
export class TimetableModule {}
