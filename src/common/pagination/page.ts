import { BadRequestException } from '@nestjs/common';
import type { PageQueryDto } from './page-query.dto';

export interface Page<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export function createPage<T>(data: T[], total: number, query: PageQueryDto): Page<T> {
  const totalPages = Math.ceil(total / query.limit);
  return {
    data,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  };
}

export function pageOffset(query: PageQueryDto): number {
  return (query.page - 1) * query.limit;
}

/** Never pass an arbitrary client field through to an ORM or SQL ORDER BY. */
export function resolveSort<const T extends string>(
  requested: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (requested === undefined) return fallback;
  const field = allowed.find((candidate) => candidate === requested);
  if (!field) throw new BadRequestException('Unsupported sort field');
  return field;
}
