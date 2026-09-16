import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A calendar date with no time, such as 2026-09-01.
 *
 * Checked here for shape only. Whether the dates make sense together, a term
 * inside its session or no two terms overlapping, is enforced by the database,
 * because only the database can enforce it under concurrent writes.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = (field: string) => `${field} must be a date in YYYY-MM-DD form`;

/** Short human names: a session, a term, an arm, a subject. */
const NAME_MAX = 120;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class CreateAcademicSessionDto {
  @ApiProperty({ example: '2026/2027' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiProperty({ example: '2026-09-01' })
  @Matches(ISO_DATE, { message: DATE_MESSAGE('startsOn') })
  startsOn!: string;

  @ApiProperty({ example: '2027-07-31' })
  @Matches(ISO_DATE, { message: DATE_MESSAGE('endsOn') })
  endsOn!: string;
}

export class CreateTermDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sessionId!: string;

  @ApiProperty({ example: 'First Term' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiProperty({ example: '2026-09-01' })
  @Matches(ISO_DATE, { message: DATE_MESSAGE('startsOn') })
  startsOn!: string;

  @ApiProperty({ example: '2026-12-15' })
  @Matches(ISO_DATE, { message: DATE_MESSAGE('endsOn') })
  endsOn!: string;
}

export class CreateGradeLevelDto {
  @ApiProperty({ example: 'JSS 2' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiProperty({
    example: 8,
    description: 'Order within the school, used for promotion. JSS 2 comes before JSS 3.',
  })
  @IsInt()
  @Min(0)
  position!: number;
}

export class CreateClassDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sessionId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  gradeLevelId!: string;

  @ApiProperty({ example: 'A', description: 'The arm. Compared case-insensitively.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX)
  arm!: string;
}

export class CreateSubjectDto {
  @ApiProperty({ example: 'Mathematics' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiPropertyOptional({ example: 'MTH' })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  code?: string;
}

/** Anchors an existing membership as a student or a teacher. */
export class CreateClassSupervisorDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  classId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  teacherId!: string;
}

export class CreateClassSubjectDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  classId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  subjectId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  teacherId!: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'An elective is taken only by students registered for it. A core subject is taken by ' +
      'everyone enrolled in the class.',
  })
  @IsOptional()
  @IsBoolean()
  isElective?: boolean;
}

/**
 * Enrols a student in a class.
 *
 * There is deliberately no `sessionId` here. The enrolment takes the class's own
 * session, so a caller cannot record an enrolment against a session the class
 * does not belong to. The database would refuse that too, through the composite
 * key, but not asking for it at all is the clearer contract.
 */
export class CreateClassEnrolmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  classId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  studentId!: string;
}

export class CreateElectiveRegistrationDto {
  @ApiProperty({ format: 'uuid', description: 'The class subject, which must be an elective.' })
  @IsUUID('4')
  classSubjectId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  studentId!: string;
}

// ---------------------------------------------------------------------------
// Responses
//
// Each is a DTO rather than the entity, for the same reason as the members
// endpoint: returning rows directly is how a column added later for an internal
// reason quietly becomes part of the public API.
// ---------------------------------------------------------------------------

export class AcademicSessionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '2026/2027' }) name!: string;
  @ApiProperty({ example: '2026-09-01' }) startsOn!: string;
  @ApiProperty({ example: '2027-07-31' }) endsOn!: string;
  @ApiProperty() isCurrent!: boolean;
}

export class TermDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty({ example: 'First Term' }) name!: string;
  @ApiProperty({ example: '2026-09-01' }) startsOn!: string;
  @ApiProperty({ example: '2026-12-15' }) endsOn!: string;
}

export class GradeLevelDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'JSS 2' }) name!: string;
  @ApiProperty({ example: 8 }) position!: number;
}

export class ClassDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty({ format: 'uuid' }) gradeLevelId!: string;
  @ApiProperty({ example: 'A' }) arm!: string;
}

export class SubjectDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Mathematics' }) name!: string;
  @ApiProperty({ nullable: true, example: 'MTH' }) code!: string | null;
}

export class ClassSupervisorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) classId!: string;
  @ApiProperty({ format: 'uuid' }) teacherId!: string;
}

export class ClassSubjectDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) classId!: string;
  @ApiProperty({ format: 'uuid' }) subjectId!: string;
  @ApiProperty({ format: 'uuid' }) teacherId!: string;
  @ApiProperty() isElective!: boolean;
}

export class ClassEnrolmentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) classId!: string;
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty({ format: 'uuid' }) studentId!: string;
}

export class ElectiveRegistrationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) classSubjectId!: string;
  @ApiProperty({ format: 'uuid' }) studentId!: string;
}
