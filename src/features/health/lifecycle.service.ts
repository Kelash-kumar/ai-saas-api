import { Injectable } from '@nestjs/common';
import type { BeforeApplicationShutdown } from '@nestjs/common';

@Injectable()
export class LifecycleService implements BeforeApplicationShutdown {
  private acceptingTraffic = true;
  get ready(): boolean {
    return this.acceptingTraffic;
  }
  beforeApplicationShutdown(): void {
    this.acceptingTraffic = false;
  }
}
