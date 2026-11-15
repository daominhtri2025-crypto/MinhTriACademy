import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/errors';
import { AuthUser, TokensService } from './tokens.service';

export type AuthedRequest = Request & { user: AuthUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokensService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHENTICATED', 'Cần đăng nhập');
    req.user = await this.tokens.verifyAccess(h.slice(7));
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser =>
  ctx.switchToHttp().getRequest<AuthedRequest>().user);
