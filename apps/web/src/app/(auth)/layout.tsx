import { Brand } from '@/components/app/brand';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Brand className="mb-8" />
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-10 text-[11px] text-muted-foreground">TronMonitor · Çapraz platform altyapı yönetim platformu</p>
    </div>
  );
}
