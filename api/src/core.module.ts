import { DynamicModule, Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { AppConfig, CONFIG, loadConfig } from './config/config';
import { DbService } from './db/db.service';
import { MailService } from './mail/mail.service';
import { NetworkService } from './network/network.service';
import { RateLimitService } from './ratelimit/rate-limit.service';
import { RedisService } from './redis/redis.service';
import { PasswordService } from './security/password.service';

const providers = [DbService, RedisService, RateLimitService, NetworkService, AuditService, MailService, PasswordService];

/** Hạ tầng dùng chung (toàn cục): cấu hình, DB, Redis, rate limit, audit, mail. */
@Global()
@Module({})
export class CoreModule {
  static forRoot(cfg: AppConfig = loadConfig()): DynamicModule {
    return {
      module: CoreModule,
      providers: [{ provide: CONFIG, useValue: cfg }, ...providers],
      exports: [CONFIG, ...providers],
    };
  }
}
