'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, LogOut, Menu, UserCog, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Brand } from '@/components/app/brand';
import { hasPermission, useAuthStatus, useLogout, useMe } from '@/hooks/use-auth';
import { useRealtime } from '@/hooks/use-realtime';
import { NAV_ITEMS } from '@/lib/navigation';
import { ROLE_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('tr-TR') ?? '')
    .join('');
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const status = useAuthStatus({ enabled: me.data === null });
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);
  const realtime = useRealtime(!!me.data);

  useEffect(() => {
    if (me.data === null) {
      if (status.data?.setupRequired) router.replace('/kurulum');
      else if (status.data) router.replace('/giris');
    }
  }, [me.data, status.data, router]);

  if (me.isPending || me.data === null) {
    return (
      <div className="flex min-h-screen">
        <aside className="hidden w-60 border-r border-border p-4 lg:block">
          <Skeleton className="h-8 w-36" />
          <div className="mt-6 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </aside>
        <div className="flex-1 p-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-6 h-40 w-full" />
        </div>
      </div>
    );
  }

  if (me.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium">Oturum bilgisi alınamadı</p>
          <p className="mt-1 text-sm text-muted-foreground">Sunucuya ulaşılamıyor olabilir. Bağlantınızı kontrol edip yeniden deneyin.</p>
          <Button className="mt-4" variant="outline" onClick={() => me.refetch()}>
            Yeniden dene
          </Button>
        </div>
      </div>
    );
  }

  const user = me.data;
  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || hasPermission(user, item.permission));

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <Brand />
        <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Menüyü kapat" onClick={() => setMobileOpen(false)}>
          <X />
        </Button>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {visibleItems.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  active && 'bg-sidebar-accent text-sidebar-foreground font-medium',
                )}
              >
                <item.icon className={cn('size-4 shrink-0', active ? 'text-brand' : 'text-muted-foreground')} aria-hidden />
                <span className="truncate">{item.label}</span>
                {item.pending && <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground/70">yakında</span>}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between border-t border-border p-3 text-[11px] text-muted-foreground">
        <span>TronMonitor v0.1.0</span>
        <span className="inline-flex items-center gap-1.5" title={realtime.connected ? 'Gerçek zamanlı güncellemeler etkin' : 'Gerçek zamanlı bağlantı yok; veriler düzenli aralıklarla yenilenir'}>
          <span className={realtime.connected ? 'size-1.5 rounded-full bg-status-ok' : 'size-1.5 rounded-full bg-status-neutral'} aria-hidden />
          {realtime.connected ? 'Canlı' : 'Yoklama'}
        </span>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-sidebar lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-sidebar shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Menüyü aç" onClick={() => setMobileOpen(true)}>
              <Menu />
            </Button>
            <Brand compact className="lg:hidden" />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 px-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">{initials(user.fullName)}</span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-sm">{user.fullName}</span>
                  <span className="block text-[11px] text-muted-foreground">{ROLE_LABELS[user.role]}</span>
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate text-sm font-medium">{user.fullName}</span>
                <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/hesap">
                  <UserCog /> Hesap ayarları
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
                <LogOut /> Çıkış yap
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
