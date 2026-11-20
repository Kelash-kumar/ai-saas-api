import type {
  DeepPartial,
  EntityManager,
  EntityTarget,
  FindOptionsWhere,
  Repository,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BaseEntity } from './base.entity';
import type { PageQueryDto } from '../pagination/page-query.dto';
import { createPage, pageOffset, resolveSort } from '../pagination/page';
import type { Page } from '../pagination/page';
import { mapDatabaseError } from '../errors/database-error';

/** Internal persistence API. Never return entities directly from HTTP controllers. */
export abstract class BaseRepository<T extends BaseEntity> {
  protected constructor(
    private readonly target: EntityTarget<T>,
    protected readonly manager: EntityManager,
  ) {}

  protected get repository(): Repository<T> {
    const runner = this.manager.queryRunner;
    if (runner && (runner.isReleased || !runner.isTransactionActive)) {
      throw new Error('Transaction repository used outside its active transaction');
    }
    return this.manager.getRepository(this.target);
  }

  protected async execute<R>(operation: () => Promise<R>): Promise<R> {
    try {
      return await operation();
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  findAll(where: FindOptionsWhere<T> = {}, limit = 100): Promise<T[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('Invalid result limit');
    return this.execute(() =>
      this.repository
        .createQueryBuilder('record')
        .setFindOptions({ where })
        .orderBy('record.id', 'ASC')
        .take(limit)
        .getMany(),
    );
  }

  findById(id: string): Promise<T | null> {
    return this.findOne({ id } as FindOptionsWhere<T>);
  }

  findOne(where: FindOptionsWhere<T>): Promise<T | null> {
    if (Object.keys(where).length === 0)
      throw new BadRequestException('Lookup criteria are required');
    return this.execute(() => this.repository.findOneBy(where));
  }

  create(input: DeepPartial<T>): Promise<T> {
    return this.execute(async () => {
      const entity = this.repository.create(input);
      entity.id ||= randomUUID();
      // INSERT deliberately rejects duplicate IDs; save() could silently update an existing record.
      await this.repository.insert(entity as QueryDeepPartialEntity<T>);
      const created = await this.findById(entity.id);
      if (!created) throw new Error('Created record could not be loaded');
      return created;
    });
  }

  async update(id: string, changes: QueryDeepPartialEntity<T>): Promise<T | null> {
    return this.execute(async () => {
      const result = await this.repository.update({ id } as FindOptionsWhere<T>, changes);
      return result.affected ? this.findById(id) : null;
    });
  }

  delete(id: string): Promise<boolean> {
    return this.execute(
      async () => (await this.repository.delete({ id } as FindOptionsWhere<T>)).affected === 1,
    );
  }

  exists(where: FindOptionsWhere<T>): Promise<boolean> {
    return this.execute(() => this.repository.existsBy(where));
  }
  count(where: FindOptionsWhere<T> = {}): Promise<number> {
    return this.execute(() => this.repository.countBy(where));
  }

  paginate(
    query: PageQueryDto,
    allowedSortFields: readonly (keyof T & string)[],
    defaultSort: keyof T & string,
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[] = {},
  ): Promise<Page<T>> {
    if (
      !Number.isInteger(query.page) ||
      query.page < 1 ||
      query.page > 10000 ||
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      !['asc', 'desc'].includes(query.sortOrder)
    )
      throw new BadRequestException('Invalid pagination');
    const field = resolveSort(query.sortBy, allowedSortFields, defaultSort);
    return this.execute(async () => {
      const builder = this.repository
        .createQueryBuilder('record')
        .setFindOptions({ where })
        .orderBy(`record.${field}`, query.sortOrder === 'asc' ? 'ASC' : 'DESC');
      if (field !== 'id') builder.addOrderBy('record.id', 'ASC');
      const [rows, total] = await builder
        .skip(pageOffset(query))
        .take(query.limit)
        .getManyAndCount();
      return createPage(rows, total, query);
    });
  }
}
