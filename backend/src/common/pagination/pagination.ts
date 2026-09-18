import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Page size when the caller does not ask for one. */
export const DEFAULT_PAGE_LIMIT = 25;

/**
 * Largest page anyone may request.
 *
 * A cap rather than merely a default. A default only helps callers who omit the
 * parameter; the cap is what stops one asking for every member of the largest
 * school in a single query. Blueprint section 54 is about exactly that school.
 */
export const MAX_PAGE_LIMIT = 100;

/**
 * The query parameters every list endpoint accepts.
 *
 * Extracted from the members endpoint when the academic spine became its second
 * consumer. Copying it into each new controller would have meant five copies of
 * a limit and a cap, and the version that drifted would be the one that stopped
 * capping.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_LIMIT, default: DEFAULT_PAGE_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: `limit must be between 1 and ${MAX_PAGE_LIMIT}` })
  @Max(MAX_PAGE_LIMIT, { message: `limit must be between 1 and ${MAX_PAGE_LIMIT}` })
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset must be zero or greater' })
  offset?: number;
}

/** A requested page, with defaults applied. */
export interface PageRequest {
  readonly limit: number;
  readonly offset: number;
}

/**
 * One page of results and the total under the same scope.
 *
 * `total` is the count of rows this caller may see, not the count in the table.
 * Every list endpoint must derive it from the same scoped query as `items`: a
 * scoped list beside an unscoped total still reveals how many rows exist beyond
 * the caller's reach, and paging then lets them walk that boundary. The action
 * base's `scopedQuery` followed by `getManyAndCount` is the way to get both.
 */
export interface Page<T> {
  readonly items: T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** Applies the defaults. Validation has already enforced the bounds. */
export function toPageRequest(query: PaginationQueryDto): PageRequest {
  return {
    limit: query.limit ?? DEFAULT_PAGE_LIMIT,
    offset: query.offset ?? 0,
  };
}
