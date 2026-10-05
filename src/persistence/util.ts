import { createHash } from 'node:crypto';
import type { Queryable } from '../server/db.ts';

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function audit(db: Queryable, actorId: string | null, action: string, entityType: string, entityId: string | number | null, details: Record<string, unknown> = {}): Promise<void> {
  await db.query('INSERT INTO app.audit_event (actor_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [actorId, action, entityType, entityId === null ? null : String(entityId), JSON.stringify(details)]);
}

/** An error the API turns into a response with this status and message. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
