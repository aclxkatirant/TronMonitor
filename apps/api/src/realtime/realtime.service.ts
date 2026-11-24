import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

export type RealtimeEventType =
  | 'server.registered'
  | 'server.updated'
  | 'server.status'
  | 'server.deleted'
  | 'server.metrics'
  | 'agent.revoked'
  | 'incident.created'
  | 'incident.updated'
  | 'check.status';

export interface RealtimeEvent {
  type: RealtimeEventType;
  payload: Record<string, unknown>;
  at: string;
}

/**
 * Uygulama içi olay yayını. WebSocket ağ geçidi bu akışa abone olur ve bağlı panolara iletir.
 */
@Injectable()
export class RealtimeService {
  private readonly subject = new Subject<RealtimeEvent>();

  get events(): Observable<RealtimeEvent> {
    return this.subject.asObservable();
  }

  emit(type: RealtimeEventType, payload: Record<string, unknown>): void {
    this.subject.next({ type, payload, at: new Date().toISOString() });
  }
}
