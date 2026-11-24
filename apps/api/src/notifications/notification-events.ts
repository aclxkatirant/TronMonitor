import { IncidentType } from '../generated/prisma/client';

/** Bildirim gönderilebilecek olay türleri. Kanal yapılandırması bu anahtarlardan oluşan bir liste tutar. */
export const NOTIFICATION_EVENTS = {
  AGENT_DISCONNECTED: 'Ajan bağlantısı kesildi / sunucu çevrimdışı',
  AGENT_RECOVERED: 'Ajan yeniden bağlandı / sunucu çevrimiçi',
  CHECK_DOWN: 'Erişilebilirlik kontrolü başarısız',
  CHECK_RECOVERED: 'Erişilebilirlik kontrolü toparlandı',
  HIGH_CPU: 'Yüksek CPU kullanımı',
  HIGH_MEMORY: 'Yüksek bellek kullanımı',
  LOW_DISK: 'Düşük disk alanı',
  RESOURCE_RECOVERED: 'Kaynak kullanımı normale döndü',
  SERVICE_FAILURE: 'Hizmet durdu',
  SERVICE_RECOVERED: 'Hizmet yeniden çalışıyor',
  SSL_EXPIRING: 'SSL sertifikası süresi doluyor',
  SSL_RENEWED: 'SSL sertifikası yenilendi',
  NETWORK_FAILURE: 'Ağ hatası',
  SERVER_UNAVAILABLE: 'Sunucu erişilemiyor',
} as const;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;
export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[];

/** Olay türü açıldığında gönderilecek bildirim olayı. */
export function eventForIncident(type: IncidentType): NotificationEvent {
  return type;
}

/** Olay türü çözüldüğünde gönderilecek toparlanma olayı. */
export function recoveryEventForIncident(type: IncidentType): NotificationEvent {
  switch (type) {
    case IncidentType.AGENT_DISCONNECTED:
    case IncidentType.SERVER_UNAVAILABLE:
      return 'AGENT_RECOVERED';
    case IncidentType.CHECK_DOWN:
    case IncidentType.NETWORK_FAILURE:
      return 'CHECK_RECOVERED';
    case IncidentType.HIGH_CPU:
    case IncidentType.HIGH_MEMORY:
    case IncidentType.LOW_DISK:
      return 'RESOURCE_RECOVERED';
    case IncidentType.SERVICE_FAILURE:
      return 'SERVICE_RECOVERED';
    case IncidentType.SSL_EXPIRING:
      return 'SSL_RENEWED';
    default:
      return 'AGENT_RECOVERED';
  }
}
