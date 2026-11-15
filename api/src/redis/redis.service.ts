import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig, CONFIG } from '../config/config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(CONFIG) cfg: AppConfig) {
    this.client = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: 2, enableReadyCheck: true });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
