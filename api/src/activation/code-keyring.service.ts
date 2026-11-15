import { Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG, Pepper } from '../config/config';
import { hmacSha256 } from '../security/crypto.util';

/** HMAC-SHA256(pepper, mã chuẩn hóa). Mã thô không bao giờ được lưu; hỗ trợ xoay khóa nhờ `hmac_key_id`. */
@Injectable()
export class CodeKeyring {
  private readonly peppers: Pepper[];

  constructor(@Inject(CONFIG) cfg: AppConfig) {
    this.peppers = cfg.peppers;
  }

  /** Khóa hiện hành (dùng khi sinh mã mới). */
  get current(): Pepper {
    return this.peppers[0];
  }

  hmacWith(pepper: Pepper, normalized: string): Buffer {
    return hmacSha256(pepper.key, normalized);
  }

  /** Mọi HMAC ứng viên (một cho mỗi khóa còn hiệu lực) để tra cứu trong giai đoạn xoay khóa. */
  candidates(normalized: string): Buffer[] {
    return this.peppers.map((p) => this.hmacWith(p, normalized));
  }
}
