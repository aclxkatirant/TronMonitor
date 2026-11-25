'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useInvalidate } from '@/hooks/use-operations';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { ServerCredentialView, SshCredentialType, TerminalServerItem } from '@/lib/types';

/**
 * Sunucunun SSH kimlik bilgisi (parola veya özel anahtar). Sır yalnızca gönderilir, hiçbir zaman geri
 * okunmaz; güncellemede boş bırakılırsa mevcut sır korunur.
 */
export function CredentialDialog({ server, existing, open, onOpenChange }: { server: TerminalServerItem; existing: ServerCredentialView | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [type, setType] = useState<SshCredentialType>(existing?.type ?? 'SSH_PASSWORD');
  const [username, setUsername] = useState(existing?.username ?? '');
  const [host, setHost] = useState(existing?.host ?? '');
  const [port, setPort] = useState(String(existing?.port ?? 22));
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const invalidate = useInvalidate([['terminal']]);

  const save = useMutation({
    mutationFn: () =>
      api.put<ServerCredentialView>(`/servers/${server.id}/credential`, {
        type,
        username: username.trim(),
        host: host.trim() || undefined,
        port: Number(port),
        password: type === 'SSH_PASSWORD' && password ? password : undefined,
        privateKey: type === 'SSH_KEY' && privateKey.trim() ? privateKey : undefined,
        passphrase: type === 'SSH_KEY' && passphrase ? passphrase : undefined,
      }),
    onSuccess: async () => {
      toast.success('SSH kimlik bilgisi kaydedildi.');
      await invalidate();
      onOpenChange(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/servers/${server.id}/credential`),
    onSuccess: async () => {
      toast.success('SSH kimlik bilgisi silindi.');
      await invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const needsSecret = !existing || existing.type !== type;
  const secretMissing = type === 'SSH_PASSWORD' ? !password : !privateKey.trim();
  const canSave = username.trim().length > 0 && Number(port) >= 1 && Number(port) <= 65535 && !(needsSecret && secretMissing);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (canSave) save.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>SSH kimlik bilgisi: {server.name}</DialogTitle>
            <DialogDescription>Merkezi sunucu bu bilgilerle SSH bağlantısı kurar. Sır şifreli saklanır ve bir daha görüntülenemez; sunucu anahtarı ilk bağlantıda öğrenilir ve sonraki bağlantılarda doğrulanır.</DialogDescription>
          </DialogHeader>
          {existing && (
            <p className="text-xs text-muted-foreground">
              Kayıtlı: {existing.username}@{existing.host ?? server.hostname ?? '?'}:{existing.port} · {existing.type === 'SSH_KEY' ? 'özel anahtar' : 'parola'} · {formatDateTime(existing.updatedAt)}
              {existing.hostFingerprint && <span className="block font-mono">{existing.hostFingerprint}</span>}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="c-type">Yöntem</Label>
              <Select value={type} onValueChange={(v) => setType(v as SshCredentialType)}>
                <SelectTrigger id="c-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SSH_PASSWORD">Parola</SelectItem>
                  <SelectItem value="SSH_KEY">Özel anahtar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-user">Kullanıcı adı</Label>
              <Input id="c-user" value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={64} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-host">Bağlantı adresi</Label>
              <Input id="c-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder={server.hostname ?? 'IP veya DNS adı'} maxLength={253} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-port">Port</Label>
              <Input id="c-port" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
          </div>
          {type === 'SSH_PASSWORD' ? (
            <div className="space-y-1.5">
              <Label htmlFor="c-pass">Parola{existing?.type === 'SSH_PASSWORD' && ' (değiştirmek için doldurun)'}</Label>
              <Input id="c-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={512} autoComplete="new-password" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="c-key">Özel anahtar (PEM / OpenSSH){existing?.type === 'SSH_KEY' && ' — değiştirmek için yapıştırın'}</Label>
                <Textarea id="c-key" value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} rows={6} className="font-mono text-xs" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" spellCheck={false} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-phrase">Anahtar parolası (varsa)</Label>
                <Input id="c-phrase" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} maxLength={512} autoComplete="new-password" />
              </div>
            </>
          )}
          {save.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(save.error)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="sm:justify-between">
            <div>
              {existing && (
                <Button type="button" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  Kimlik bilgisini sil
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Vazgeç
              </Button>
              <Button type="submit" disabled={!canSave || save.isPending}>
                {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
