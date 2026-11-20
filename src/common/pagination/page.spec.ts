import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PageQueryDto } from './page-query.dto';
import { createPage, pageOffset, resolveSort } from './page';

describe('Pagination primitives', () => {
  it.each([
    { page: '0' },
    { page: '10001' },
    { limit: '101' },
    { limit: 'abc' },
    { sortOrder: 'DROP' },
  ])('rejects unsafe or unbounded input: %j', async (input) => {
    expect((await validate(plainToInstance(PageQueryDto, input))).length).toBeGreaterThan(0);
  });

  it('converts query strings explicitly and computes page metadata', () => {
    const query = plainToInstance(PageQueryDto, { page: '2', limit: '10' });
    expect(pageOffset(query)).toBe(10);
    expect(createPage(['a'], 21, query).meta).toEqual({
      total: 21,
      page: 2,
      limit: 10,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('handles an empty dataset and a page past the end', () => {
    expect(createPage([], 0, new PageQueryDto()).meta.totalPages).toBe(0);
    const query = plainToInstance(PageQueryDto, { page: 5 });
    expect(createPage([], 1, query).meta.hasNextPage).toBe(false);
  });

  it('resolves only endpoint-authorized sort fields', () => {
    expect(resolveSort(undefined, ['id', 'createdAt'], 'id')).toBe('id');
    expect(resolveSort('createdAt', ['id', 'createdAt'], 'id')).toBe('createdAt');
    expect(() => resolveSort('passwordHash', ['id', 'createdAt'], 'id')).toThrow(
      'Unsupported sort field',
    );
    expect(() => resolveSort('id; DROP TABLE users', ['id'], 'id')).toThrow();
  });
});
