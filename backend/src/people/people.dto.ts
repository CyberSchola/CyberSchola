import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  registerDecorator,
  ValidateIf,
} from 'class-validator';

import { PaginationQueryDto } from '../common/pagination/pagination';
import { GuardianRelationship } from './entities/guardianship.entity';

const NAME_MAX = 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A person's name: a string, not blank, at most NAME_MAX characters.
 *
 * One rule with one message rather than three validators, so a caller who sends
 * `null` is told what a name must be instead of receiving a length complaint
 * about a value that has no length.
 */
function isPersonName(value: unknown): boolean {
  return typeof value === 'string' && /\S/.test(value) && value.length <= NAME_MAX;
}

/**
 * A required name that may be omitted on update but never cleared.
 *
 * `ValidateIf` rather than `IsOptional`: `IsOptional` also skips validation for
 * `null`, which would let a PATCH write a null into a NOT NULL column and surface
 * as a database error instead of a clear 400.
 */
function nameRules(field: string, optional: boolean): PropertyDecorator {
  return (target, key) => {
    if (optional) {
      ValidateIf((_, value) => value !== undefined)(target, key);
    }
    registerDecorator({
      name: 'isPersonName',
      target: target.constructor,
      propertyName: key as string,
      options: {
        message: `${field} must be a name of 1 to ${NAME_MAX} characters, not blank`,
      },
      validator: { validate: isPersonName },
    });
  };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class CreateStudentDto {
  @ApiProperty({ example: 'Amaka' })
  @nameRules('firstName', false)
  firstName!: string;

  @ApiProperty({ example: 'Okafor' })
  @nameRules('lastName', false)
  lastName!: string;

  @ApiPropertyOptional({ example: 'Chiamaka', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  otherNames?: string | null;

  @ApiPropertyOptional({ example: '2014-03-09', nullable: true })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'dateOfBirth must be a date in YYYY-MM-DD form' })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({
    example: 'GFC/2026/014',
    nullable: true,
    description:
      'Unique within the school while the student is on roll. Compared case-insensitively.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  admissionNumber?: string | null;
}

export class UpdateStudentDto {
  @ApiPropertyOptional({ example: 'Amaka' })
  @nameRules('firstName', true)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Okafor' })
  @nameRules('lastName', true)
  lastName?: string;

  @ApiPropertyOptional({ example: 'Chiamaka', nullable: true, description: 'null clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  otherNames?: string | null;

  @ApiPropertyOptional({ example: '2014-03-09', nullable: true, description: 'null clears it.' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'dateOfBirth must be a date in YYYY-MM-DD form' })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ example: 'GFC/2026/014', nullable: true, description: 'null clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  admissionNumber?: string | null;
}

export class CreateTeacherDto {
  @ApiProperty({ example: 'Tunde' })
  @nameRules('firstName', false)
  firstName!: string;

  @ApiProperty({ example: 'Adeyemi' })
  @nameRules('lastName', false)
  lastName!: string;
}

export class UpdateTeacherDto {
  @ApiPropertyOptional({ example: 'Tunde' })
  @nameRules('firstName', true)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Adeyemi' })
  @nameRules('lastName', true)
  lastName?: string;
}

export class CreateParentDto {
  @ApiProperty({ example: 'Ngozi' })
  @nameRules('firstName', false)
  firstName!: string;

  @ApiProperty({ example: 'Okafor' })
  @nameRules('lastName', false)
  lastName!: string;

  @ApiPropertyOptional({ example: 'ngozi.okafor@example.com', nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ example: '+234 803 000 0000', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;
}

export class UpdateParentDto {
  @ApiPropertyOptional({ example: 'Ngozi' })
  @nameRules('firstName', true)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Okafor' })
  @nameRules('lastName', true)
  lastName?: string;

  @ApiPropertyOptional({
    example: 'ngozi.okafor@example.com',
    nullable: true,
    description: 'null clears it.',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({
    example: '+234 803 000 0000',
    nullable: true,
    description: 'null clears it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;
}

export class CreateStaffDto {
  @ApiProperty({ example: 'Bola' })
  @nameRules('firstName', false)
  firstName!: string;

  @ApiProperty({ example: 'Ahmed' })
  @nameRules('lastName', false)
  lastName!: string;

  @ApiPropertyOptional({ example: 'Bursar', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  jobTitle?: string | null;
}

export class UpdateStaffDto {
  @ApiPropertyOptional({ example: 'Bola' })
  @nameRules('firstName', true)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Ahmed' })
  @nameRules('lastName', true)
  lastName?: string;

  @ApiPropertyOptional({ example: 'Bursar', nullable: true, description: 'null clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  jobTitle?: string | null;
}

export class LinkAccountDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'A membership of this school. Linking it gives that membership this role; a membership ' +
      'already linked to another record of the same kind is refused with 409.',
  })
  @IsUUID('4')
  membershipId!: string;
}

export class CreateSchoolAdminDto extends LinkAccountDto {}

export class CreateGuardianshipDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  parentId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  studentId!: string;

  @ApiPropertyOptional({ enum: GuardianRelationship, default: GuardianRelationship.Guardian })
  @IsOptional()
  @IsEnum(GuardianRelationship)
  relationship?: GuardianRelationship;
}

export class GuardianshipQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only links to this student.' })
  @IsOptional()
  @IsUUID('4')
  studentId?: string;
}

// ---------------------------------------------------------------------------
// Responses. Only the fields a caller needs, never the entity itself.
// ---------------------------------------------------------------------------

export class StudentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Amaka' }) firstName!: string;
  @ApiProperty({ example: 'Okafor' }) lastName!: string;

  @ApiProperty({
    enum: ['summary', 'profile'],
    example: 'profile',
    description:
      'How much of the record this caller receives. `profile` goes to an administrator, to the ' +
      'student themselves and to a linked parent; everyone else, a teacher included, gets ' +
      '`summary`, and the fields below are absent.',
  })
  view!: 'summary' | 'profile';

  @ApiPropertyOptional({ example: 'Chiamaka', nullable: true, type: String })
  otherNames?: string | null;

  @ApiPropertyOptional({ example: '2014-03-09', nullable: true, type: String })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ example: 'GFC/2026/014', nullable: true, type: String })
  admissionNumber?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'The linked login, or null for a record with no account yet.',
  })
  membershipId?: string | null;
}

export class TeacherDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Tunde' }) firstName!: string;
  @ApiProperty({ example: 'Adeyemi' }) lastName!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) membershipId!: string | null;
}

export class ParentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Ngozi' }) firstName!: string;
  @ApiProperty({ example: 'Okafor' }) lastName!: string;
  @ApiProperty({ example: 'ngozi.okafor@example.com', nullable: true, type: String })
  email!: string | null;
  @ApiProperty({ example: '+234 803 000 0000', nullable: true, type: String })
  phone!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) membershipId!: string | null;
}

export class StaffDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Bola' }) firstName!: string;
  @ApiProperty({ example: 'Ahmed' }) lastName!: string;
  @ApiProperty({ example: 'Bursar', nullable: true, type: String }) jobTitle!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) membershipId!: string | null;
}

export class SchoolAdminDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) membershipId!: string;
}

export class GuardianshipDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) parentId!: string;
  @ApiProperty({ format: 'uuid' }) studentId!: string;
  @ApiProperty({ enum: GuardianRelationship }) relationship!: GuardianRelationship;
}
