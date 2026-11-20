import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly source: DataSource,
    private readonly indicators: HealthIndicatorService,
  ) {}
  async check() {
    const indicator = this.indicators.check('database');
    try {
      if (!this.source.isInitialized) return indicator.down();
      // Bounded by driver and server statement timeouts. Also require the migrated identity table.
      await this.source.query('SELECT 1 FROM users LIMIT 0');
      return indicator.up();
    } catch {
      return indicator.down();
    }
  }
}
