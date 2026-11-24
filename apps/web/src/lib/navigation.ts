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
  { href: '/sunucular', label: 'Sunucular', icon: Server, permission: 'servers.read', pending: true },
  { href: '/izleme', label: 'İzleme', icon: Gauge, permission: 'metrics.read', pending: true },
  { href: '/erisilebilirlik', label: 'Erişilebilirlik', icon: Activity, permission: 'uptime.read', pending: true },
  { href: '/olaylar', label: 'Olaylar', icon: TriangleAlert, permission: 'incidents.read', pending: true },
  { href: '/hizmetler', label: 'Hizmetler', icon: Boxes, permission: 'services.read', pending: true },
  { href: '/terminal', label: 'Terminal', icon: TerminalSquare, permission: 'terminal.use', pending: true },
  { href: '/bildirimler', label: 'Bildirimler', icon: Bell, permission: 'notifications.read', pending: true },
  { href: '/islem-kayitlari', label: 'İşlem Kayıtları', icon: ClipboardList, permission: 'audit.read', pending: true },
  { href: '/api-yonetimi', label: 'API Yönetimi', icon: KeyRound, permission: 'apitokens.own', pending: true },
  { href: '/kullanicilar', label: 'Kullanıcılar', icon: Users, permission: 'users.read' },
  { href: '/ayarlar', label: 'Ayarlar', icon: Settings, permission: 'settings.read', pending: true },
];

export const PENDING_MODULES: Record<string, { title: string; description: string }> = {
  sunucular: {
    title: 'Sunucular',
    description: 'Sunucu kaydı, ajan kurulum komutları, gruplar ve etiketler bu modülde yer alacak.',
  },
  izleme: {
    title: 'İzleme',
    description: 'CPU, bellek, disk ve ağ metrikleri ile geçmiş performans grafikleri bu modülde yer alacak.',
  },
  erisilebilirlik: {
    title: 'Erişilebilirlik',
    description: 'HTTP, HTTPS, TCP ve ICMP kontrolleri ile SSL sertifika takibi bu modülde yer alacak.',
  },
  olaylar: {
    title: 'Olaylar',
    description: 'Kesinti ve eşik aşımı olaylarının tespiti, üstlenilmesi ve çözümü bu modülde yer alacak.',
  },
  hizmetler: {
    title: 'Hizmetler',
    description: 'Windows hizmetleri ve systemd birimlerinin izlenmesi bu modülde yer alacak.',
  },
  terminal: {
    title: 'Terminal',
    description: 'Güvenli SSH ve PowerShell web terminali bu modülde yer alacak.',
  },
  bildirimler: {
    title: 'Bildirimler',
    description: 'Discord, Telegram ve e-posta bildirim kanalları bu modülde yapılandırılacak.',
  },
  'islem-kayitlari': {
    title: 'İşlem Kayıtları',
    description: 'Aranabilir ve filtrelenebilir denetim kayıtları bu modülde görüntülenecek.',
  },
  'api-yonetimi': {
    title: 'API Yönetimi',
    description: 'Programatik erişim için API belirteçleri bu modülde yönetilecek.',
  },
  ayarlar: {
    title: 'Ayarlar',
    description: 'Sistem genelindeki ayarlar bu modülde yönetilecek.',
  },
};
