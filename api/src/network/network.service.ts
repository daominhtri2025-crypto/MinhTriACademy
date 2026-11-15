import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

/**
 * Mạng tin cậy của trung tâm (ADR-003). Chỉ dùng để NỚI rate limit theo IP.
 * Miễn quota thiết bị cần thêm máy kiosk đã đăng ký (xem DevicesService).
 */
@Injectable()
export class NetworkService {
  private readonly cache = new Map<string, { at: number; trusted: boolean }>();
  private static readonly TTL_MS = 30_000;

  constructor(private readonly db: DbService) {}

  async isTrusted(ip: string): Promise<boolean> {
    const hit = this.cache.get(ip);
    if (hit && Date.now() - hit.at < NetworkService.TTL_MS) return hit.trusted;
    let trusted = false;
    try {
      const r = await this.db.query(
        'SELECT 1 FROM trusted_networks WHERE is_active AND relax_ip_rate_limit AND $1::inet <<= cidr LIMIT 1', [ip]);
      trusted = (r.rowCount ?? 0) > 0;
    } catch {
      trusted = false; // IP không hợp lệ → không tin
    }
    this.cache.set(ip, { at: Date.now(), trusted });
    return trusted;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
