import { QueryFailedError } from 'typeorm';
import { mapDatabaseError } from './database-error';
import { ApplicationException } from './application.exception';

describe('Database error boundary', () => {
  it.each([
    ['23505', 409, 'RESOURCE_CONFLICT'],
    ['23503', 400, 'INVALID_REFERENCE'],
    ['23514', 400, 'INVALID_DATA'],
    ['23502', 400, 'INVALID_DATA'],
    ['22P02', 400, 'INVALID_DATA'],
    ['40001', 409, 'TRANSACTION_RETRY'],
    ['40P01', 409, 'TRANSACTION_RETRY'],
  ])('maps SQLSTATE %s without leaking driver values', (code, status, expectedCode) => {
    const error = new QueryFailedError(
      'INSERT SECRET_SQL',
      ['SECRET_PASSWORD'],
      Object.assign(new Error('SECRET_DETAIL'), { code }),
    );
    const result = mapDatabaseError(error);
    expect(result).toBeInstanceOf(ApplicationException);
    if (!(result instanceof ApplicationException)) throw new Error('Expected an application error');
    expect(result.getStatus()).toBe(status);
    expect(result.getResponse()).toMatchObject({ code: expectedCode });
    expect(JSON.stringify(result.getResponse())).not.toContain('SECRET');
  });

  it('leaves unknown errors for the safe global 500 filter', () => {
    const error = new QueryFailedError('SECRET_SQL', [], new Error('SECRET'));
    expect(mapDatabaseError(error)).toBe(error);
    const plain = new Error('plain');
    expect(mapDatabaseError(plain)).toBe(plain);
  });
});
