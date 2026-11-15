import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Lỗi nghiệp vụ có mã ổn định cho client: { error: { code, message, details? } }. */
export class AppError extends HttpException {
  constructor(status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, status);
  }
}

export const rateLimited = (retryAfterSec: number) =>
  new AppError(429, 'RATE_LIMITED', 'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau.', { retry_after: retryAfterSec });

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');

  catch(ex: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (ex instanceof HttpException) {
      const status = ex.getStatus();
      const body = ex.getResponse() as { error?: { details?: { retry_after?: number } }; message?: unknown } | string;
      const payload =
        typeof body === 'object' && body?.error
          ? body
          : { error: { code: `HTTP_${status}`, message: String(typeof body === 'string' ? body : body?.message ?? ex.message) } };
      const retry = (payload as { error: { details?: { retry_after?: number } } }).error.details?.retry_after;
      if (status === 429 && retry) res.setHeader('Retry-After', String(retry));
      res.status(status).json(payload);
      return;
    }
    // Không ghi nội dung request (có thể chứa mật khẩu/mã); chỉ ghi stack.
    this.log.error(ex instanceof Error ? ex.stack : String(ex));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Lỗi hệ thống' } });
  }
}
