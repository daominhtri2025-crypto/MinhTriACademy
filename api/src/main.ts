import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot(cfg));
  configureApp(app, cfg);
  app.enableShutdownHooks();
  await app.listen(cfg.PORT);
  new Logger('Bootstrap').log(`API sẵn sàng tại :${cfg.PORT}/v1 (${cfg.NODE_ENV})`);
}

bootstrap().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
