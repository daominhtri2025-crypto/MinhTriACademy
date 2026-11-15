import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';

export interface MailMessage { to: string; subject: string; text: string }

/**
 * Cổng gửi thư. Bản hiện tại là STUB: chưa có nhà cung cấp SMTP/API.
 * - development: in toàn bộ nội dung ra log (để lấy link xác minh/OTP khi phát triển).
 * - test: lưu vào `outbox` để kiểm thử.
 * - production: chỉ log metadata (KHÔNG log token/OTP) và PHẢI thay bằng nhà cung cấp thật trước khi chạy.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  readonly outbox: MailMessage[] = [];

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  async send(msg: MailMessage): Promise<void> {
    if (this.cfg.NODE_ENV === 'test') {
      this.outbox.push(msg);
      if (this.outbox.length > 200) this.outbox.shift();
      return;
    }
    if (this.cfg.NODE_ENV === 'development') this.log.log(`[DEV MAIL] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    else this.log.warn(`Mail chưa được cấu hình nhà cung cấp; bỏ qua thư tới ${msg.to} ("${msg.subject}")`);
  }
}
