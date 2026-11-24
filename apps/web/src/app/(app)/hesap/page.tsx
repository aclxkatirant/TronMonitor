'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { MonitorSmartphone } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMe } from '@/hooks/use-auth';
import { api, errorMessage } from '@/lib/api';
import { describeUserAgent, formatDateTime, formatRelative } from '@/lib/format';
import type { UserSessionInfo } from '@/lib/types';

const SESSIONS_KEY = ['auth', 'sessions'] as const;

function ProfileCard() {
  const me = useMe();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profil</CardTitle>
        <CardDescription>Hesabınıza ait temel bilgiler.</CardDescription>
      </CardHeader>
      <CardContent>
        {me.data ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Ad soyad</dt>
              <dd className="font-medium">{me.data.fullName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">E-posta</dt>
              <dd className="font-medium">{me.data.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Rol</dt>
              <dd>
                <Badge variant="secondary">{me.data.roleLabel}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Son giriş</dt>
              <dd className="font-medium">{formatDateTime(me.data.lastLoginAt)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">İzinler</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {me.data.permissions.map((p) => (
                  <Badge key={p} variant="outline" className="font-mono text-[11px]">
                    {p}
                  </Badge>
                ))}
              </dd>
            </div>
          </dl>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </CardContent>
    </Card>
  );
}

function ChangePasswordCard() {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordAgain, setNewPasswordAgain] = useState('');
  const mismatch = newPasswordAgain.length > 0 && newPassword !== newPasswordAgain;

  const mutation = useMutation({
    mutationFn: () => api.post<{ revokedSessions: number }>('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: async (result) => {
      toast.success(
        result.revokedSessions > 0
          ? `Parolanız güncellendi. ${result.revokedSessions} diğer oturum kapatıldı.`
          : 'Parolanız güncellendi.',
      );
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordAgain('');
      await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mismatch) return;
    mutation.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Parola değiştir</CardTitle>
        <CardDescription>Parolanızı değiştirdiğinizde bu cihaz dışındaki tüm oturumlar kapatılır.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="max-w-md space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">Mevcut parola</Label>
            <Input id="currentPassword" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">Yeni parola</Label>
            <Input id="newPassword" type="password" autoComplete="new-password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">En az 12 karakter; harf ve rakam içermeli.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPasswordAgain">Yeni parola (tekrar)</Label>
            <Input id="newPasswordAgain" type="password" autoComplete="new-password" required value={newPasswordAgain} onChange={(e) => setNewPasswordAgain(e.target.value)} aria-invalid={mismatch} />
            {mismatch && <p className="text-xs text-destructive">Parolalar eşleşmiyor.</p>}
          </div>
          {mutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={mutation.isPending || !currentPassword || !newPassword || mismatch}>
            {mutation.isPending ? 'Güncelleniyor…' : 'Parolayı güncelle'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: () => api.get<UserSessionInfo[]>('/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/auth/sessions/${id}`),
    onSuccess: async () => {
      toast.success('Oturum sonlandırıldı.');
      await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Etkin oturumlar</CardTitle>
        <CardDescription>Hesabınıza açık olan tüm tarayıcı oturumları. Tanımadığınız bir oturumu sonlandırın.</CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : sessions.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(sessions.error)}</AlertDescription>
          </Alert>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>İstemci</TableHead>
                <TableHead>IP adresi</TableHead>
                <TableHead>Son etkinlik</TableHead>
                <TableHead>Başlangıç</TableHead>
                <TableHead className="text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.data.map((session) => (
                <TableRow key={session.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <MonitorSmartphone className="size-4 text-muted-foreground" aria-hidden />
                      {describeUserAgent(session.userAgent)}
                      {session.isCurrent && <Badge variant="secondary">Bu cihaz</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{session.ipAddress ?? '—'}</TableCell>
                  <TableCell>{formatRelative(session.lastSeenAt)}</TableCell>
                  <TableCell>{formatDateTime(session.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(session.id)}>
                      {session.isCurrent ? 'Çıkış yap' : 'Sonlandır'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function AccountPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Hesap ayarları" description="Profil bilgileriniz, parolanız ve etkin oturumlarınız." />
      <ProfileCard />
      <ChangePasswordCard />
      <SessionsCard />
    </div>
  );
}
