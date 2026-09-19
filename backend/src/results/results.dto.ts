import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { type AssessmentType, MAX_SCORE } from './enter-scores.action';

const ASSESSMENTS: readonly AssessmentType[] = ['CA1', 'CA2', 'EXAM'];
const REMARKS_MAX = 500;

/** Largest score sheet one request may carry: a class, not a school. */
export const MAX_SHEET = 200;

export class PerformanceQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: "Defaults to the school's current session." })
  @IsOptional()
  @IsUUID('4')
  sessionId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Defaults to the latest term of the session that has results.',
  })
  @IsOptional()
  @IsUUID('4')
  termId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  classId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  subjectId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  studentId?: string;
}

export class NamedDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'SS2 A' }) name!: string;
}

export class TermRefDto extends NamedDto {
  @ApiProperty({ example: '2026-01-05' }) startsOn!: string;
  @ApiProperty({ example: '2026-05-22' }) endsOn!: string;
}

export class SubjectScoreDto {
  @ApiProperty({ format: 'uuid' }) subjectId!: string;
  @ApiProperty({ example: 'Mathematics' }) subject!: string;
  @ApiProperty({ example: 14, nullable: true, type: Number }) ca1!: number | null;
  @ApiProperty({ example: 16, nullable: true, type: Number }) ca2!: number | null;
  @ApiProperty({ example: 42, nullable: true, type: Number }) exam!: number | null;
  @ApiProperty({ example: 72, description: 'CA1 + CA2 + exam, out of 100.' }) total!: number;
}

export class StudentPerformanceDto {
  @ApiProperty({ format: 'uuid' }) studentId!: string;
  @ApiProperty({ example: 'Daniel Okafor' }) name!: string;
  @ApiProperty({ example: 'SS2 A' }) class!: string;
  @ApiProperty({
    example: 95,
    nullable: true,
    type: Number,
    description:
      'Percent of recorded school days present or late in the term. Administrators only; ' +
      'null for others and for pupils with no register.',
  })
  attendanceRate!: number | null;
  @ApiProperty({ example: 75.6, nullable: true, type: Number, description: 'Mean subject total.' })
  average!: number | null;
  @ApiProperty({ type: [SubjectScoreDto] }) subjects!: SubjectScoreDto[];
}

export class SubjectSummaryDto {
  @ApiProperty({ format: 'uuid' }) subjectId!: string;
  @ApiProperty({ example: 'Mathematics' }) subject!: string;
  @ApiProperty({ example: 55.5 }) average!: number;
  @ApiProperty({ example: 82 }) highest!: number;
  @ApiProperty({ example: 35 }) lowest!: number;
  @ApiProperty({ example: 4, description: 'Pupils whose total is below 50.' }) below50!: number;
  @ApiProperty({ example: 11 }) students!: number;
}

export class PerformanceDto {
  @ApiProperty({ type: NamedDto }) session!: NamedDto;
  @ApiProperty({ type: TermRefDto }) term!: TermRefDto;
  @ApiProperty({ type: NamedDto, nullable: true }) class!: NamedDto | null;
  @ApiProperty({ type: [SubjectSummaryDto] }) subjects!: SubjectSummaryDto[];
  @ApiProperty({ type: [StudentPerformanceDto] }) students!: StudentPerformanceDto[];
}

/** Which score sheet: one class subject in one term. */
export class ScoreSheetQueryDto {
  @ApiProperty({ format: 'uuid', description: 'The class subject, from GET /assignments.' })
  @IsUUID('4', { message: 'classSubjectId must be a uuid' })
  classSubjectId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'termId must be a uuid' })
  termId!: string;
}

/** One pupil's score for the assessment being entered. */
export class ScoreEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'studentId must be a uuid' })
  studentId!: string;

  @ApiProperty({
    example: 14.5,
    minimum: 0,
    maximum: MAX_SCORE.EXAM,
    description: 'Up to two decimal places. At most 20 for CA1 and CA2, 60 for the exam.',
  })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'score must be a number with at most 2 decimals' })
  @Min(0, { message: 'score must not be negative' })
  @Max(MAX_SCORE.EXAM, { message: `score must be at most ${MAX_SCORE.EXAM}` })
  score!: number;

  @ApiPropertyOptional({ maxLength: REMARKS_MAX })
  @IsOptional()
  @IsString({ message: 'remarks must be text' })
  @MaxLength(REMARKS_MAX, { message: `remarks must be at most ${REMARKS_MAX} characters` })
  remarks?: string;
}

/**
 * One assessment's scores for a class subject in a term.
 *
 * A pupil with no score yet gets one; a pupil with one has it corrected. The
 * whole sheet is saved in one transaction, so it is never half saved.
 */
export class SaveScoresDto extends ScoreSheetQueryDto {
  @ApiProperty({ enum: ASSESSMENTS, example: 'CA1' })
  @IsIn(ASSESSMENTS, { message: `assessmentType must be one of ${ASSESSMENTS.join(', ')}` })
  assessmentType!: AssessmentType;

  @ApiPropertyOptional({ example: '2026-02-13', description: 'Defaults to today.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'assessedOn must be a date in YYYY-MM-DD form' })
  @IsISO8601({ strict: true }, { message: 'assessedOn must be a real calendar date' })
  assessedOn?: string;

  @ApiProperty({ type: [ScoreEntryDto], maxItems: MAX_SHEET })
  @IsArray({ message: 'entries must be a list' })
  @ArrayNotEmpty({ message: 'entries must name at least one pupil' })
  @ArrayMaxSize(MAX_SHEET, { message: `entries must hold at most ${MAX_SHEET} pupils` })
  @ValidateNested({ each: true })
  @Type(() => ScoreEntryDto)
  entries!: ScoreEntryDto[];
}

export class SheetRowDto {
  @ApiProperty({ format: 'uuid' }) studentId!: string;
  @ApiProperty({ example: 'Daniel Okafor' }) name!: string;
  @ApiProperty({ example: 14, nullable: true, type: Number }) ca1!: number | null;
  @ApiProperty({ example: 16, nullable: true, type: Number }) ca2!: number | null;
  @ApiProperty({ example: 42, nullable: true, type: Number }) exam!: number | null;
  @ApiProperty({ example: 72, description: 'CA1 + CA2 + exam so far, out of 100.' })
  total!: number;
}

export class TermNameDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Second Term' }) name!: string;
}

export class MaxScoresDto {
  @ApiProperty({ example: 20 }) ca1!: number;
  @ApiProperty({ example: 20 }) ca2!: number;
  @ApiProperty({ example: 60 }) exam!: number;
}

export class ScoreSheetDto {
  @ApiProperty({ format: 'uuid' }) classSubjectId!: string;
  @ApiProperty({ example: 'Mathematics' }) subject!: string;
  @ApiProperty({ example: 'SS2 A' }) class!: string;
  @ApiProperty({ type: TermNameDto }) term!: TermNameDto;
  @ApiProperty({ type: MaxScoresDto }) maxScores!: MaxScoresDto;
  @ApiProperty({ type: [SheetRowDto] }) pupils!: SheetRowDto[];
}

export class SavedScoresDto extends ScoreSheetDto {
  @ApiProperty({ example: 'CA1', enum: ASSESSMENTS }) assessmentType!: AssessmentType;
  @ApiProperty({ example: 3, description: 'Pupils given a score for the first time.' })
  inserted!: number;
  @ApiProperty({ example: 9, description: 'Pupils whose existing score was corrected.' })
  updated!: number;
}

/** A score sheet the caller may open: a class subject, and the terms of its session. */
export class SheetOptionDto {
  @ApiProperty({ format: 'uuid' }) classSubjectId!: string;
  @ApiProperty({ example: 'Mathematics' }) subject!: string;
  @ApiProperty({ example: 'SS2 A' }) class!: string;
  @ApiProperty({ type: [TermNameDto], description: "The session's terms, in order." })
  terms!: TermNameDto[];
}
