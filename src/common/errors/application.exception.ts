import { HttpException } from '@nestjs/common';

/** Only explicitly public messages and stable machine-readable codes belong here. */
export class ApplicationException extends HttpException {
  constructor(status: number, code: string, publicMessage: string) {
    super({ message: publicMessage, code }, status);
  }
}
