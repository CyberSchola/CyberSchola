import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

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
