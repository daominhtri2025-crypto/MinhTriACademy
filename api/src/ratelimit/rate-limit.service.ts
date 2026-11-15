import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { rateLimited } from '../common/errors';

export interface RateRule { key: string; limit: number; windowMs: number }
export interface RateStatus { blocked: boolean; count: number; retryAfterSec: number }

// Cửa sổ trượt bằng sorted set. Cắt cửa sổ + đếm + lấy mốc cũ nhất trong MỘT lệnh nguyên tử.
const STATUS_LUA = `
local now = tonumber(ARGV[1]); local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local oldestScore = now
if oldest[2] then oldestScore = tonumber(oldest[2]) end
return {count, oldestScore}
`;

/**
 * Giới hạn tốc độ theo cửa sổ trượt. Tách `status` (chỉ đọc) và `hit` (ghi nhận) để có thể
 * CHỈ ĐẾM LẦN THẤT BẠI: kiểm tra trước khi xử lý, ghi nhận sau khi biết kết quả.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async status(key: string, limit: number, windowMs: number): Promise<RateStatus> {
    const now = Date.now();
    const [count, oldest] = (await this.redis.client.eval(STATUS_LUA, 1, `rl:${key}`, String(now), String(windowMs))) as [number, number];
    const blocked = count >= limit;
    const retryAfterSec = blocked ? Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) : 0;
    return { blocked, count, retryAfterSec };
  }

  async hit(key: string, windowMs: number): Promise<void> {
    const now = Date.now();
    const k = `rl:${key}`;
    await this.redis.client.multi().zadd(k, now, `${now}:${randomBytes(4).toString('hex')}`).pexpire(k, windowMs).exec();
  }

  async reset(key: string): Promise<void> {
    await this.redis.client.del(`rl:${key}`);
  }

  /** Ném 429 nếu BẤT KỲ luật nào đang bị chặn; Retry-After = thời gian chờ lâu nhất. */
  async enforce(rules: RateRule[]): Promise<void> {
    const results = await Promise.all(rules.map((r) => this.status(r.key, r.limit, r.windowMs)));
    const blocked = results.filter((r) => r.blocked);
    if (blocked.length) throw rateLimited(Math.max(...blocked.map((b) => b.retryAfterSec)));
  }

  async hitAll(rules: RateRule[]): Promise<void> {
    await Promise.all(rules.map((r) => this.hit(r.key, r.windowMs)));
  }
}
