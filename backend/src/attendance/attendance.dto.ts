import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../common/pagination/pagination';
import {
  AttendanceContext,
  AttendanceStatus,
  AttendanceType,
  STATUSES_BY_TYPE,
} from './attendance.enums';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'date must be a calendar date in YYYY-MM-DD form';
const REMARKS_MAX = 500;
const REASON_MAX = 500;

/**
 * Largest register one request may carry.
 *
 * A class, not a school. Blueprint section 54 is about schools with thousands of
 * students, and the endpoint that marks a class is not the endpoint that should
 * be able to write to all of them at once.
 */
export const MAX_ROSTER = 200;

/** One line of a class register. */
export class RosterEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'studentId must be a uuid' })
  studentId!: string;

  @ApiProperty({ enum: STATUSES_BY_TYPE[AttendanceType.Student] })
  @IsEnum(AttendanceStatus, {
    message: `status must be one of ${STATUSES_BY_TYPE[AttendanceType.Student].join(', ')}`,
  })
  status!: AttendanceStatus;

  @ApiPropertyOptional({ maxLength: REMARKS_MAX })
  @IsOptional()
  @IsString({ message: 'remarks must be text' })
  @MaxLength(REMARKS_MAX, { message: `remarks must be at most ${REMARKS_MAX} characters` })
  remarks?: string;
}

/**
 * A whole class register for one day.
 *
 * The roster is the request: every student marked in one call, in one
 * transaction, so a saved register is never half a register.
 */
export class MarkClassAttendanceDto {
  @ApiProperty({ example: '2026-09-17', description: 'The school day being marked.' })
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  date!: string;

  @ApiProperty({ type: [RosterEntryDto], maxItems: MAX_ROSTER })
  @IsArray({ message: 'entries must be a list' })
  @ArrayNotEmpty({ message: 'entries must name at least one student' })
  @ArrayMaxSize(MAX_ROSTER, { message: `entries must hold at most ${MAX_ROSTER} students` })
  @ValidateNested({ each: true })
  @Type(() => RosterEntryDto)
  entries!: RosterEntryDto[];
}

/** One teacher's or staff member's day. */
export class MarkEmployeeAttendanceDto {
  @ApiProperty({ example: '2026-09-17' })
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  date!: string;

  @ApiProperty({ enum: AttendanceStatus })
  @IsEnum(AttendanceStatus, { message: 'status is not one of the attendance statuses' })
  status!: AttendanceStatus;

  @ApiPropertyOptional({ example: '2026-09-17T07:45:00.000Z' })
  @IsOptional()
  @IsISO8601({}, { message: 'checkInTime must be an ISO 8601 timestamp' })
  checkInTime?: string;

  @ApiPropertyOptional({ example: '2026-09-17T15:10:00.000Z' })
  @IsOptional()
  @IsISO8601({}, { message: 'checkOutTime must be an ISO 8601 timestamp' })
  checkOutTime?: string;

  @ApiPropertyOptional({ maxLength: REMARKS_MAX })
  @IsOptional()
  @IsString({ message: 'remarks must be text' })
  @MaxLength(REMARKS_MAX, { message: `remarks must be at most ${REMARKS_MAX} characters` })
  remarks?: string;
}

/**
 * A staff member or teacher recording their own arrival.
 *
 * Deliberately not the same shape as marking someone: there is no subject to
 * name, because the subject is the caller, and `status` defaults to PRESENT
 * because a person checking themselves in has arrived.
 */
export class SelfCheckInDto {
  @ApiPropertyOptional({ example: '2026-09-17', description: 'Defaults to today.' })
  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  date?: string;

  @ApiPropertyOptional({ enum: AttendanceStatus, default: AttendanceStatus.Present })
  @IsOptional()
  @IsEnum(AttendanceStatus, { message: 'status is not one of the attendance statuses' })
  status?: AttendanceStatus;

  @ApiPropertyOptional({ example: '2026-09-17T07:45:00.000Z', description: 'Defaults to now.' })
  @IsOptional()
  @IsISO8601({}, { message: 'checkInTime must be an ISO 8601 timestamp' })
  checkInTime?: string;

  @ApiPropertyOptional({ maxLength: REMARKS_MAX })
  @IsOptional()
  @IsString({ message: 'remarks must be text' })
  @MaxLength(REMARKS_MAX, { message: `remarks must be at most ${REMARKS_MAX} characters` })
  remarks?: string;
}

/**
 * A change to a recorded status.
 *
 * The reason is required by the request and again by the database, which refuses
 * an update with none. Blueprint section 96: the trail exists to settle disputes,
 * and a trail of blank reasons settles nothing.
 */
export class CorrectAttendanceDto {
  @ApiProperty({ enum: AttendanceStatus })
  @IsEnum(AttendanceStatus, { message: 'status is not one of the attendance statuses' })
  status!: AttendanceStatus;

  @ApiProperty({
    maxLength: REASON_MAX,
    example: 'Marked absent in error; the pupil arrived during registration.',
  })
  @IsString({ message: 'reason must be text' })
  @Matches(/\S/, { message: 'reason must say why the record is being changed' })
  @MaxLength(REASON_MAX, { message: `reason must be at most ${REASON_MAX} characters` })
  reason!: string;
}

/** Narrowing a caller may ask for on a list. */
export class AttendanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AttendanceType })
  @IsOptional()
  @IsEnum(AttendanceType, { message: 'attendanceType is not one of the attendance types' })
  attendanceType?: AttendanceType;

  @ApiPropertyOptional({ example: '2026-09-17', description: 'A single day.' })
  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  date?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Start of a range, inclusive.' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be a calendar date in YYYY-MM-DD form' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'End of a range, inclusive.' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be a calendar date in YYYY-MM-DD form' })
  to?: string;
}

/**
 * An attendance record as the API returns it.
 *
 * Every nullable field names its type explicitly. A `string | null` property
 * with no `type` produces a schema Swagger cannot render, so the example value
 * comes out as `{}`: documentation that looks complete and tells a reader
 * nothing about what the field holds.
 */
export class AttendanceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: AttendanceType })
  attendanceType!: AttendanceType;

  @ApiProperty({ enum: AttendanceContext })
  attendanceContext!: AttendanceContext;

  @ApiProperty({ example: '2026-09-17' })
  date!: string;

  @ApiProperty({ enum: AttendanceStatus })
  status!: AttendanceStatus;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  studentId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  teacherId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  staffId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  classId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  sessionId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  termId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  checkInTime!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  checkOutTime!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: REMARKS_MAX,
    example: 'Bus was late',
  })
  remarks!: string | null;

  @ApiProperty({ format: 'uuid', description: 'The membership that recorded it.' })
  markedBy!: string;
}

/** One entry in a record's correction history. */
export class AttendanceCorrectionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  attendanceId!: string;

  @ApiProperty({ enum: AttendanceStatus })
  previousStatus!: AttendanceStatus;

  @ApiProperty({ enum: AttendanceStatus })
  newStatus!: AttendanceStatus;

  @ApiProperty({
    maxLength: REASON_MAX,
    example: 'Marked absent in error; the pupil arrived during registration.',
  })
  reason!: string;

  @ApiProperty({ format: 'uuid', description: 'The membership that made the change.' })
  changedBy!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  changedAt!: string;
}
