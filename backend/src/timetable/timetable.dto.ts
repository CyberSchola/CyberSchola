import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * A time of day on the 24-hour clock, such as 09:20.
 *
 * Shape only. That a period ends after it starts, and does not overlap another
 * on the same day, is the database's to enforce.
 */
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = (field: string) => `${field} must be a time in HH:MM form, 00:00 to 23:59`;

/** Matches the database's check on a period label. */
const LABEL_MAX = 40;

/** Present on a PATCH means validate it; absent means leave it alone. Null is never allowed. */
const WhenPresent = () => ValidateIf((_, value) => value !== undefined);

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class CreatePeriodDto {
  @ApiProperty({ format: 'uuid', description: 'The session this period belongs to.' })
  @IsUUID('4')
  sessionId!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 7, description: 'ISO weekday: Monday is 1.' })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @ApiProperty({ example: 'P3', description: 'Unique per weekday within the session.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(LABEL_MAX)
  label!: string;

  @ApiProperty({ example: '09:20' })
  @Matches(CLOCK_TIME, { message: TIME_MESSAGE('startsAt') })
  startsAt!: string;

  @ApiProperty({ example: '10:00' })
  @Matches(CLOCK_TIME, { message: TIME_MESSAGE('endsAt') })
  endsAt!: string;
}

/**
 * Changes a period in place. Its lessons move with it, since they point at it.
 *
 * The session is not here: a period belongs to its session for life, and its
 * lessons' classes belong to that session too.
 */
export class UpdatePeriodDto {
  @ApiPropertyOptional({ example: 3, minimum: 1, maximum: 7 })
  @WhenPresent()
  @IsInt()
  @Min(1)
  @Max(7)
  weekday?: number;

  @ApiPropertyOptional({ example: 'P3' })
  @WhenPresent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(LABEL_MAX)
  label?: string;

  @ApiPropertyOptional({ example: '09:20' })
  @WhenPresent()
  @Matches(CLOCK_TIME, { message: TIME_MESSAGE('startsAt') })
  startsAt?: string;

  @ApiPropertyOptional({ example: '10:00' })
  @WhenPresent()
  @Matches(CLOCK_TIME, { message: TIME_MESSAGE('endsAt') })
  endsAt?: string;
}

/**
 * Which session to read. Optional everywhere it appears: the school's current
 * session is what a timetable almost always means.
 */
export class SessionQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: "Defaults to the school's current session.",
  })
  @IsOptional()
  @IsUUID('4')
  sessionId?: string;
}

/**
 * Places a class subject in a period.
 *
 * Only the two ids. The class, the teacher and whether it is an elective all
 * come from the class subject, and the session from the period, so a caller
 * cannot describe a lesson that disagrees with the assignments it is built on.
 */
export class CreateLessonDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  periodId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The subject, as taught in one class by one teacher.',
  })
  @IsUUID('4')
  classSubjectId!: string;
}

/** Moves a lesson to another period of the same session. */
export class MoveLessonDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  periodId!: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class PeriodDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty({ example: 2, description: 'ISO weekday: Monday is 1.' }) weekday!: number;
  @ApiProperty({ example: 'Tuesday' }) weekdayName!: string;
  @ApiProperty({ example: 'P3' }) label!: string;
  @ApiProperty({ example: '09:20' }) startsAt!: string;
  @ApiProperty({ example: '10:00' }) endsAt!: string;
}

/** A thing a lesson names: the id to follow and the words to show. */
export class NamedRefDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'JSS 2 A' }) name!: string;
}

export class LessonPeriodDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 2 }) weekday!: number;
  @ApiProperty({ example: 'Tuesday' }) weekdayName!: string;
  @ApiProperty({ example: 'P3' }) label!: string;
  @ApiProperty({ example: '09:20' }) startsAt!: string;
  @ApiProperty({ example: '10:00' }) endsAt!: string;
}

export class LessonDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: LessonPeriodDto }) period!: LessonPeriodDto;

  @ApiProperty({
    type: NamedRefDto,
    example: { id: '5b1c0e8e-1f43-4a8e-9e7e-2f9d7c1a4b10', name: 'JSS 2 A' },
  })
  class!: NamedRefDto;

  @ApiProperty({
    type: NamedRefDto,
    example: { id: '8a4e2f61-7c0d-4b9a-a3e5-6d2c9f1b0e77', name: 'Mathematics' },
  })
  subject!: NamedRefDto;

  @ApiProperty({
    type: NamedRefDto,
    example: { id: 'c3d9a7b2-4e1f-4c6a-8b0d-1e2f3a4b5c6d', name: 'Adaeze Okonkwo' },
  })
  teacher!: NamedRefDto;

  @ApiProperty({ format: 'uuid' }) classSubjectId!: string;

  @ApiProperty({
    example: false,
    description: 'Electives are taught only to pupils registered for them.',
  })
  isElective!: boolean;
}

export class ConflictLessonDto {
  @ApiProperty({ format: 'uuid' }) id!: string;

  @ApiProperty({
    type: NamedRefDto,
    example: { id: '8a4e2f61-7c0d-4b9a-a3e5-6d2c9f1b0e77', name: 'French' },
  })
  subject!: NamedRefDto;

  @ApiProperty({
    type: NamedRefDto,
    example: { id: 'c3d9a7b2-4e1f-4c6a-8b0d-1e2f3a4b5c6d', name: 'Adaeze Okonkwo' },
  })
  teacher!: NamedRefDto;
}

/** A pupil registered for more than one of the electives running in a period. */
export class TimetableConflictDto {
  @ApiProperty({
    type: NamedRefDto,
    example: { id: '0f9e8d7c-6b5a-4c3d-9e2f-1a0b9c8d7e6f', name: 'Zainab Bello' },
  })
  student!: NamedRefDto;

  @ApiProperty({
    type: NamedRefDto,
    example: { id: '5b1c0e8e-1f43-4a8e-9e7e-2f9d7c1a4b10', name: 'SS 2 A' },
  })
  class!: NamedRefDto;

  @ApiProperty({ type: LessonPeriodDto }) period!: LessonPeriodDto;

  @ApiProperty({
    type: [ConflictLessonDto],
    description: 'Every elective they take in this period.',
  })
  lessons!: ConflictLessonDto[];
}
