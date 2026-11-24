import {
  Activity,
  Bell,
  Boxes,
  ClipboardList,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Server,
  Settings,
  TerminalSquare,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Görünmesi için gereken izin; tanımsızsa herkes görür. */
  permission?: string;
  /** Henüz etkin olmayan modül; sayfa açıklayıcı bir durum gösterir. */
  pending?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Genel Bakış', icon: LayoutDashboard, permission: 'dashboard.read' },
  { href: '/sunucular', label: 'Sunucular', icon: Server, permission: 'servers.read' },
  { href: '/izleme', label: 'İzleme', icon: Gauge, permission: 'metrics.read' },
  { href: '/erisilebilirlik', label: 'Erişilebilirlik', icon: Activity, permission: 'uptime.read' },
  { href: '/olaylar', label: 'Olaylar', icon: TriangleAlert, permission: 'incidents.read' },
  { href: '/hizmetler', label: 'Hizmetler', icon: Boxes, permission: 'services.read' },
  { href: '/terminal', label: 'Terminal', icon: TerminalSquare, permission: 'terminal.use', pending: true },
  { href: '/bildirimler', label: 'Bildirimler', icon: Bell, permission: 'notifications.read' },
  { href: '/islem-kayitlari', label: 'İşlem Kayıtları', icon: ClipboardList, permission: 'audit.read' },
  { href: '/api-yonetimi', label: 'API Yönetimi', icon: KeyRound, permission: 'apitokens.own' },
  { href: '/kullanicilar', label: 'Kullanıcılar', icon: Users, permission: 'users.read' },
  { href: '/ayarlar', label: 'Ayarlar', icon: Settings, permission: 'settings.read' },
];

export const PENDING_MODULES: Record<string, { title: string; description: string }> = {
  terminal: {
    title: 'Terminal',
    description: 'Güvenli SSH ve PowerShell web terminali bu modülde yer alacak.',
  },
};
