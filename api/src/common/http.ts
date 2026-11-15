import { CanActivate, ExecutionContext, Inject, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig, CONFIG } from '../config/config';
import { AppError } from './errors';

/** Express có thể trả IPv4 dạng ::ffff:1.2.3.4. */
export function normalizeIp(ip?: string | null): string {
  if (!ip) return '0.0.0.0';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/** IP của client. Chỉ đáng tin khi TRUST_PROXY khớp số tầng reverse proxy thật sự của mình. */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string =>
  normalizeIp(ctx.switchToHttp().getRequest<Request>().ip));

export const UserAgent = createParamDecorator((_: unknown, ctx: ExecutionContext): string =>
  (ctx.switchToHttp().getRequest<Request>().headers['user-agent'] ?? '').slice(0, 300));

/**
 * Phòng CSRF cho API dùng cookie: yêu cầu thay đổi trạng thái từ trình duyệt luôn kèm Origin;
 * nếu có Origin mà không thuộc ALLOWED_ORIGINS → từ chối. Client không phải trình duyệt (không Origin) được qua.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const origin = req.headers.origin;
    if (!origin || this.cfg.ALLOWED_ORIGINS.length === 0) return true;
    if (!this.cfg.ALLOWED_ORIGINS.includes(origin)) {
      throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Nguồn yêu cầu không được phép');
    }
    return true;
  }
}
