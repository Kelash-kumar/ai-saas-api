import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';
import type { RuntimeConfig } from '../config/runtime-config.service';

export function loggingOptions(config: RuntimeConfig): Options {
  return {
    name: config.app.name,
    level: config.logging.level,
    // Allow-list request and response fields. Bodies, URLs (including queries),
    // user agents, cookies, authorization, and arbitrary headers never enter logs.
    serializers: {
      req: (request: { id: string; method: string }) => ({
        id: request.id,
        method: request.method,
      }),
      res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
      err: (error: Error) => ({ type: error.name, stack: safeStack(error) }),
    },
    redact: {
      paths: [
        'password',
        'token',
        'secret',
        'authorization',
        'cookie',
        '*.password',
        '*.token',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
    genReqId: (_request: IncomingMessage, response: ServerResponse) => {
      // Generate at this trust boundary rather than trusting an arbitrary client header.
      const id = (_request as IncomingMessage & { id?: string }).id ?? randomUUID();
      response.setHeader('X-Request-Id', id);
      return id;
    },
    customLogLevel: (_request, response, error) =>
      error || response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info',
    customSuccessMessage: () => 'HTTP request completed',
    customErrorMessage: () => 'HTTP request failed',
  };
}

export function safeStack(error: Error): string | undefined {
  // Retain stack frames internally, omit exception message, which may contain secrets.
  return error.stack
    ?.split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');
}
