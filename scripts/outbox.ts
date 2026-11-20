import 'reflect-metadata';
import { DataSource, IsNull, Not } from 'typeorm';
import { isUUID } from 'class-validator';
import { loadCliConfig } from '../src/core/config/load-cli-config';
import { databaseOptions } from '../src/core/database/database.options';
import { MailOutboxEntity } from '../src/features/notifications/entities/mail-outbox.entity';

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'status' && command !== 'retry') throw new Error('Invalid outbox command');
  const source = await new DataSource(databaseOptions(loadCliConfig().database)).initialize();
  try {
    const repository = source.getRepository(MailOutboxEntity);
    if (command === 'status') {
      const [pending, dead, processed, leased] = await Promise.all([
        repository.countBy({ processedAt: IsNull(), deadAt: IsNull() }),
        repository.countBy({ deadAt: Not(IsNull()) }),
        repository.countBy({ processedAt: Not(IsNull()) }),
        repository.countBy({ leaseId: Not(IsNull()), processedAt: IsNull(), deadAt: IsNull() }),
      ]);
      console.log(JSON.stringify({ pending, dead, processed, leased }));
    } else {
      const id = process.argv[3];
      if (!id || !isUUID(id)) throw new Error('Supply an outbox UUID');
      const result = await repository.update(
        { id, deadAt: Not(IsNull()), processedAt: IsNull() },
        {
          deadAt: null,
          leaseId: null,
          leasedUntil: null,
          attempts: 0,
          lastErrorCode: null,
          availableAt: new Date(),
        },
      );
      console.log(
        result.affected
          ? 'Dead-letter message requeued.'
          : 'No eligible dead-letter message found.',
      );
    }
  } finally {
    await source.destroy();
  }
}
void main().catch(() => {
  console.error('Outbox command failed; check configuration, database and command arguments.');
  process.exitCode = 1;
});
