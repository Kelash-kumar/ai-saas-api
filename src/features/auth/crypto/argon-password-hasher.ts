import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { randomBytes } from 'node:crypto';
import { ApplicationException } from '../../../common/errors/application.exception';
import type { PasswordHasher } from '../interfaces/auth.types';

@Injectable()
export class ArgonPasswordHasher implements PasswordHasher, OnModuleInit {
  private dummyHash = '';
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString('hex'));
  }

  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= 4) {
      if (this.waiting.length >= 32)
        throw new ApplicationException(
          503,
          'AUTH_BUSY',
          'Authentication capacity reached; retry shortly',
        );
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running++;
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }

  hash(password: string): Promise<string> {
    return this.bounded(() =>
      hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
    );
  }

  verify(encoded: string | undefined, password: string): Promise<boolean> {
    return this.bounded(async () => {
      try {
        const matches = await verify(encoded ?? this.dummyHash, password);
        return encoded !== undefined && matches;
      } catch {
        return false;
      }
    });
  }
}
