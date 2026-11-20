import { QueryFailedError } from 'typeorm';
import { ApplicationException } from './application.exception';

/** No SQL, constraint names, driver details or submitted values cross the application boundary. */
export function mapDatabaseError(error: unknown): unknown {
  if (!(error instanceof QueryFailedError)) return error;
  const driver: unknown = error.driverError;
  const code = driver && typeof driver === 'object' && 'code' in driver ? driver.code : undefined;
  switch (code) {
    case '23505':
      return new ApplicationException(409, 'RESOURCE_CONFLICT', 'Resource already exists');
    case '23503':
      return new ApplicationException(400, 'INVALID_REFERENCE', 'Referenced resource is invalid');
    case '23514':
    case '23502':
    case '22P02':
      return new ApplicationException(400, 'INVALID_DATA', 'Data violates persistence constraints');
    case '40001':
    case '40P01':
      return new ApplicationException(
        409,
        'TRANSACTION_RETRY',
        'Concurrent change; retry the operation',
      );
    default:
      return error;
  }
}
