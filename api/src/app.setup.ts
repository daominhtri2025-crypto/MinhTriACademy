import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { AllExceptionsFilter, AppError } from './common/errors';
import { AppConfig } from './config/config';

/** Cấu hình dùng chung cho main.ts và kiểm thử, để test chạy đúng như production. */
export function configureApp(app: INestApplication, cfg: AppConfig): void {
  const express = app.getHttpAdapter().getInstance();
  if (cfg.TRUST_PROXY > 0) express.set('trust proxy', cfg.TRUST_PROXY);
  express.disable('x-powered-by');

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store'); // phản hồi chứa token, không được cache
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(cookieParser());
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new AppError(422, 'VALIDATION_FAILED', 'Dữ liệu không hợp lệ',
        errors.map((e) => ({ field: e.property, problems: Object.values(e.constraints ?? {}) }))),
  }));
  app.useGlobalFilters(new AllExceptionsFilter());
}
