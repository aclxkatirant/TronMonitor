'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { CommandBlock } from '@/components/app/copy-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useGroups, usePlatforms, useRegistrationTokens } from '@/hooks/use-servers';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { OS_FAMILY_LABELS, OS_VERSION_LABELS, type OsFamily, type RegistrationTokenRecord } from '@/lib/types';
import { cn } from '@/lib/utils';

const NO_GROUP = '__none__';

interface TokenResult {
  token: string;
  record: RegistrationTokenRecord;
}

function buildCommands(origin: string, osFamily: OsFamily, token: string, architecture: string) {
  const insecure = origin.startsWith('http://');
  const base = `${origin}/api/v1/agent-downloads`;
  if (osFamily === 'LINUX') {
    const flags = insecure ? ' --allow-http' : '';
    return {
      primary: `curl -fsSL ${base}/install-agent.sh -o /tmp/install-agent.sh && sudo bash /tmp/install-agent.sh --server ${origin} --token ${token}${flags}`,
      manual: `sudo ./tronmonitor-agent-linux-${architecture} install --server ${origin} --token ${token}${flags}`,
      binary: `${base}/tronmonitor-agent-linux-${architecture}`,
    };
  }
  const flags = insecure ? ' -AllowHttp' : '';
  return {
    primary: `powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '${base}/install-agent.ps1' -OutFile \\"$env:TEMP\\install-agent.ps1\\"; & \\"$env:TEMP\\install-agent.ps1\\" -Server '${origin}' -Token '${token}'${flags}"`,
    manual: `.\\tronmonitor-agent-windows-${architecture}.exe install --server ${origin} --token ${token}${insecure ? ' --allow-http' : ''}`,
    binary: `${base}/tronmonitor-agent-windows-${architecture}.exe`,
  };
}

export default function AddServerPage() {
  const queryClient = useQueryClient();
  const platforms = usePlatforms();
  const groups = useGroups();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [osFamily, setOsFamily] = useState<OsFamily | null>(null);
  const [osVersion, setOsVersion] = useState('');
  const [architecture, setArchitecture] = useState('amd64');
  const [serverName, setServerName] = useState('');
  const [groupId, setGroupId] = useState(NO_GROUP);
  const [ttl, setTtl] = useState('60');
  const [result, setResult] = useState<TokenResult | null>(null);
  // Kurulum komutları panonun tarayıcıda görünen adresiyle üretilir; yalnızca 3. adımda kullanıldığından
  // sunucu tarafı ön işleme ile uyumsuzluk oluşmaz.
  const [origin] = useState(() => (typeof window === 'undefined' ? '' : window.location.origin));

  const create = useMutation({
    mutationFn: () =>
      api.post<TokenResult>('/registration-tokens', {
        osFamily,
        osVersion: osVersion || undefined,
        architecture,
        serverName: serverName.trim() || undefined,
        groupId: groupId === NO_GROUP ? undefined : groupId,
        ttlMinutes: Number(ttl),
      }),
    onSuccess: async (data) => {
      setResult(data);
      setStep(3);
      await queryClient.invalidateQueries({ queryKey: ['registration-tokens'] });
    },
  });

  // Kayıt tamamlanana kadar belirteç durumu yoklanır; WebSocket olayı da listeyi geçersiz kılar.
  const tokens = useRegistrationTokens({ refetchInterval: step === 3 ? 5_000 : undefined, enabled: step === 3 });
  const liveRecord = result ? (tokens.data?.find((t) => t.id === result.record.id) ?? result.record) : null;
  const registered = liveRecord?.status === 'USED' && liveRecord.usedByServerId;
  const expired = liveRecord?.status === 'EXPIRED' || liveRecord?.status === 'REVOKED';

  function restart() {
    setResult(null);
    setStep(1);
    setOsFamily(null);
    setOsVersion('');
    setServerName('');
  }

  const commands = result && osFamily && origin ? buildCommands(origin, osFamily, result.token, architecture) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sunucu ekle"
        description="İşletim sistemini seçin, kayıt belirteci oluşturun ve kurulum komutunu sunucuda çalıştırın."
        actions={
          <Button asChild variant="ghost">
            <Link href="/sunucular">
              <ArrowLeft /> Sunuculara dön
            </Link>
          </Button>
        }
      />

      <ol className="flex flex-wrap gap-2 text-sm">
        {['İşletim sistemi', 'Sunucu bilgileri', 'Kurulum'].map((label, index) => {
          const n = (index + 1) as 1 | 2 | 3;
          return (
            <li key={label} className={cn('flex items-center gap-2 rounded-md border px-2.5 py-1', step === n ? 'border-brand/50 bg-brand/10' : 'border-border text-muted-foreground')}>
              <span className={cn('flex size-5 items-center justify-center rounded-full text-xs font-semibold', step > n ? 'bg-status-ok/20 text-status-ok' : step === n ? 'bg-brand text-background' : 'bg-muted')}>
                {step > n ? '✓' : n}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(['WINDOWS', 'LINUX'] as OsFamily[]).map((os) => (
            <button
              key={os}
              type="button"
              onClick={() => {
                setOsFamily(os);
                setOsVersion('');
                setStep(2);
              }}
              className={cn('rounded-lg border p-5 text-left transition-colors hover:bg-muted', osFamily === os ? 'border-brand/60 bg-brand/5' : 'border-border')}
            >
              <span className="block text-base font-semibold">{OS_FAMILY_LABELS[os]} Server</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                {os === 'WINDOWS' ? 'Windows Server 2019, 2022 ve 2025. Ajan Windows hizmeti olarak kurulur.' : 'Ubuntu Server 22.04 / 24.04 ve Debian 12. Ajan systemd birimi olarak kurulur.'}
              </span>
              <span className="mt-3 inline-flex items-center gap-1 text-sm text-brand">
                Seç <ArrowRight className="size-3.5" aria-hidden />
              </span>
            </button>
          ))}
        </div>
      )}

      {step === 2 && osFamily && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{OS_FAMILY_LABELS[osFamily]} sunucu bilgileri</CardTitle>
            <CardDescription>Belirteç bu bilgilerle oluşturulur; sunucu adı boş bırakılırsa ana makine adı kullanılır.</CardDescription>
          </CardHeader>
          <CardContent>
            {platforms.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : platforms.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(platforms.error)}</AlertDescription>
              </Alert>
            ) : (
              <form
                className="grid max-w-xl gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  create.mutate();
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="osVersion">Sürüm</Label>
                    <Select value={osVersion} onValueChange={setOsVersion}>
                      <SelectTrigger id="osVersion" className="w-full">
                        <SelectValue placeholder="Sürüm seçin" />
                      </SelectTrigger>
                      <SelectContent>
                        {platforms.data.osVersions[osFamily].map((v) => (
                          <SelectItem key={v} value={v}>
                            {OS_VERSION_LABELS[v] ?? v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="arch">Mimari</Label>
                    <Select value={architecture} onValueChange={setArchitecture}>
                      <SelectTrigger id="arch" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {platforms.data.architectures.map((a) => (
                          <SelectItem key={a} value={a}>
                            {a === 'amd64' ? 'x64 (amd64)' : 'ARM64'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="serverName">Sunucu adı (isteğe bağlı)</Label>
                  <Input id="serverName" value={serverName} onChange={(e) => setServerName(e.target.value)} placeholder="ör. Üretim Veritabanı" maxLength={120} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="group">Grup (isteğe bağlı)</Label>
                    <Select value={groupId} onValueChange={setGroupId}>
                      <SelectTrigger id="group" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_GROUP}>Grup yok</SelectItem>
                        {groups.data?.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ttl">Belirteç geçerliliği</Label>
                    <Select value={ttl} onValueChange={setTtl}>
                      <SelectTrigger id="ttl" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">15 dakika</SelectItem>
                        <SelectItem value="60">1 saat</SelectItem>
                        <SelectItem value="240">4 saat</SelectItem>
                        <SelectItem value="1440">24 saat</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {create.isError && (
                  <Alert variant="destructive">
                    <AlertDescription>{errorMessage(create.error)}</AlertDescription>
                  </Alert>
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>
                    <ArrowLeft /> Geri
                  </Button>
                  <Button type="submit" disabled={create.isPending || !osVersion}>
                    {create.isPending ? 'Oluşturuluyor…' : 'Kayıt belirteci oluştur'}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {step === 3 && result && osFamily && liveRecord && (
        <div className="space-y-4">
          {registered ? (
            <Alert>
              <CheckCircle2 className="text-status-ok" />
              <AlertDescription className="flex flex-wrap items-center gap-2">
                Sunucu başarıyla kaydedildi ve çevrimiçi.
                <Button asChild size="sm">
                  <Link href={`/sunucular/${liveRecord.usedByServerId}`}>Sunucuyu aç</Link>
                </Button>
                <Button size="sm" variant="outline" onClick={restart}>
                  Başka sunucu ekle
                </Button>
              </AlertDescription>
            </Alert>
          ) : expired ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center gap-2">
                Bu belirteç artık geçerli değil ({liveRecord.status === 'REVOKED' ? 'iptal edildi' : 'süresi doldu'}).
                <Button size="sm" variant="outline" onClick={restart}>
                  <RefreshCw /> Yeni belirteç oluştur
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <Loader2 className="animate-spin" />
              <AlertDescription>
                Kayıt bekleniyor. Belirteç {formatDateTime(liveRecord.expiresAt)} tarihine kadar geçerli ve yalnızca bir kez kullanılabilir. Komut çalıştırıldığında bu sayfa otomatik güncellenir.
              </AlertDescription>
            </Alert>
          )}

          {commands && !registered && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{OS_FAMILY_LABELS[osFamily]} kurulum komutu</CardTitle>
                <CardDescription>
                  {osFamily === 'LINUX'
                    ? 'Sunucuda root yetkisiyle çalıştırın. Betik ajanı indirir, SHA-256 özetini doğrular, kaydeder ve systemd hizmetini kurar.'
                    : 'Sunucuda yönetici PowerShell oturumunda çalıştırın. Betik ajanı indirir, SHA-256 özetini doğrular, kaydeder ve Windows hizmetini kurar.'}
                  {origin.startsWith('http://') && ' Bu pano HTTPS kullanmadığından komut yalnızca test ortamına uygun --allow-http seçeneğini içerir.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CommandBlock command={commands.primary} label="Tek satır kurulum" />
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Manuel kurulum (ikili dosyayı kendiniz indirip doğrulamak için)</summary>
                  <div className="mt-3 space-y-3">
                    <p className="text-muted-foreground">İkili dosyayı ve özet dosyasını indirin, özeti doğrulayın ve ardından kayıt komutunu çalıştırın:</p>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm">
                        <a href={commands.binary}>
                          <Download /> Ajan ({architecture})
                        </a>
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <a href={`${origin}/api/v1/agent-downloads/SHA256SUMS`}>
                          <Download /> SHA256SUMS
                        </a>
                      </Button>
                    </div>
                    <CommandBlock command={commands.manual} label="Kayıt ve hizmet kurulumu" />
                  </div>
                </details>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
