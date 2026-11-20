import { Writable } from 'node:stream';
import pino from 'pino';
import { ConfigService } from '@nestjs/config';
import { RuntimeConfig } from '../config/runtime-config.service';
import { validateEnvironment } from '../config/environment';
import type { Environment } from '../config/environment';
import { loggingOptions, safeStack } from './logging.options';
import { testAuthSettings } from '../../../test/support/auth-settings';

describe('Logging privacy', () => {
  it('excludes credentials, URLs and headers from serialized requests and errors', () => {
    const config = new RuntimeConfig(
      new ConfigService<Environment, true>(
        validateEnvironment({ DATABASE_PASSWORD: 'unit-test-password', ...testAuthSettings }),
      ),
    );
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = pino(loggingOptions(config), stream);
    logger.info(
      {
        req: {
          id: 'server-id',
          method: 'POST',
          url: '/reset?token=SECRET_URL',
          headers: { authorization: 'SECRET_HEADER' },
          body: { password: 'SECRET_BODY' },
        },
        password: 'SECRET_PASSWORD',
        err: new Error('SECRET_ERROR'),
      },
      'Request',
    );
    const output = chunks.join('');
    expect(output).not.toContain('SECRET_');
    expect(output).toContain('server-id');
    expect(output).toContain('[REDACTED]');
  });

  it('retains internal stack frames while excluding the message', () => {
    const stack = safeStack(new Error('private credential'));
    expect(stack).not.toContain('private credential');
    expect(stack).toContain('at ');
  });
});
