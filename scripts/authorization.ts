import 'reflect-metadata';
import { isEmail } from 'class-validator';
import { DataSource } from 'typeorm';
import { loadCliConfig } from '../src/core/config/load-cli-config';
import { databaseOptions } from '../src/core/database/database.options';
import { operatorGrant } from '../src/features/authorization/bootstrap';

async function main(): Promise<void> {
  const command = process.argv[2];
  const email = process.argv[3]?.trim().toLowerCase();
  const names = process.argv.slice(4);
  if (
    !['bootstrap', 'grant'].includes(command ?? '') ||
    !email ||
    !isEmail(email) ||
    names.some((name) => !/^[a-z][a-z0-9_-]{0,79}\.[a-z][a-z0-9_-]{0,79}$/.test(name))
  )
    throw new Error('Invalid operator arguments');
  if (command === 'bootstrap' && names.length)
    throw new Error('Bootstrap does not accept extra permissions');
  const source = await new DataSource(databaseOptions(loadCliConfig().database)).initialize();
  try {
    await operatorGrant(source, email, command === 'bootstrap', names);
    console.log(
      'Explicit operator permission grant committed. User profile and credentials were unchanged.',
    );
  } finally {
    await source.destroy();
  }
}
void main().catch(() => {
  console.error(
    'Authorization operator command failed; check arguments, existing catalog and active verified account.',
  );
  process.exitCode = 1;
});
