import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');

  constructor(private readonly db: DbService) {}

  /** Không bao giờ làm hỏng request chính; lỗi ghi audit chỉ được log. KHÔNG đưa mã/mật khẩu vào meta. */
  async record(e: AuditEntry): Promise<void> {
    try {
      await this.db.query(
        'INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta, ip) VALUES ($1,$2,$3,$4,$5,$6)',
        [e.actorId ?? null, e.action, e.entity, e.entityId ?? null, JSON.stringify(e.meta ?? {}), e.ip ?? null],
      );
    } catch (err) {
      this.log.error(`Không ghi được audit ${e.action}: ${(err as Error).message}`);
    }
  }
}
