import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppConfig, CONFIG } from '../config/config';
import { AppError } from '../common/errors';

// OWASP: argon2id m=19 MiB, t=2, p=1.
const ARGON: argon2.HashOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

@Injectable()
export class PasswordService {
  private readonly log = new Logger('Password');
  private dummy?: Promise<string>;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Tốn cùng thời gian như verify thật khi tài khoản không tồn tại → không lộ email nào đã đăng ký qua độ trễ. */
  async verifyDummy(password: string): Promise<void> {
    this.dummy ??= argon2.hash('dummy-password-for-timing', ARGON);
    await argon2.verify(await this.dummy, password).catch(() => false);
  }

  assertPolicy(password: string, email: string): void {
    if (password.length < 10 || password.length > 128) {
      throw new AppError(422, 'PASSWORD_POLICY', 'Mật khẩu cần từ 10 đến 128 ký tự');
    }
    if (password.toLowerCase() === email.toLowerCase()) {
      throw new AppError(422, 'PASSWORD_POLICY', 'Mật khẩu không được trùng email');
    }
  }

  /** HIBP k-anonymity: chỉ gửi 5 ký tự đầu của SHA-1. Lỗi mạng → bỏ qua (fail-open) để không chặn đăng ký. */
  async isBreached(password: string): Promise<boolean> {
    if (!this.cfg.HIBP_ENABLED) return false;
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return false;
      const suffix = sha1.slice(5);
      return (await res.text()).split('\n').some((l) => {
        const [s, count] = l.trim().split(':');
        return s === suffix && Number(count) > 0;
      });
    } catch (e) {
      this.log.warn(`HIBP không khả dụng: ${(e as Error).message}`);
      return false;
    }
  }
}
