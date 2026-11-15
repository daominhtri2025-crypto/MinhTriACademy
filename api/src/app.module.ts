import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ActivationModule } from './activation/activation.module';
import { AuthModule } from './auth/auth.module';
import { OriginGuard } from './common/http';
import { AppConfig, loadConfig } from './config/config';
import { CoreModule } from './core.module';

@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig = loadConfig()): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot(cfg), AuthModule, ActivationModule],
      providers: [{ provide: APP_GUARD, useClass: OriginGuard }],
    };
  }
}
