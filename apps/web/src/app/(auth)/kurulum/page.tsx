'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStatus, useRegister } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';

const PASSWORD_MIN = 12;

export default function SetupPage() {
  const status = useAuthStatus();
  const register = useRegister();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');

  const mismatch = passwordAgain.length > 0 && password !== passwordAgain;
  const tooShort = password.length > 0 && password.length < PASSWORD_MIN;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mismatch || tooShort) return;
    register.mutate({ fullName, email, password });
  }

  if (status.isPending) {
    return <Skeleton className="h-80 w-full" />;
  }

  if (status.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Kurulum durumu alınamadı. {errorMessage(status.error)}</AlertDescription>
      </Alert>
    );
  }

  const setupRequired = status.data.setupRequired;
  if (!setupRequired && !status.data.selfRegistrationEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Kayıt kapalı</CardTitle>
          <CardDescription>Yeni hesaplar yalnızca bir yönetici tarafından oluşturulabilir.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/giris">Giriş sayfasına dön</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{setupRequired ? 'İlk kurulum' : 'Hesap oluştur'}</CardTitle>
        <CardDescription>
          {setupRequired
            ? 'Henüz kullanıcı yok. Oluşturacağınız ilk hesap süper yönetici yetkisine sahip olacak.'
            : 'Yeni hesabınız izleyici yetkisiyle açılır; ek yetkileri bir yönetici tanımlar.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Ad soyad</Label>
            <Input id="fullName" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">E-posta</Label>
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Parola</Label>
            <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={tooShort} />
            <p className="text-xs text-muted-foreground">En az {PASSWORD_MIN} karakter; harf ve rakam içermeli.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="passwordAgain">Parola (tekrar)</Label>
            <Input id="passwordAgain" type="password" autoComplete="new-password" required value={passwordAgain} onChange={(e) => setPasswordAgain(e.target.value)} aria-invalid={mismatch} />
            {mismatch && <p className="text-xs text-destructive">Parolalar eşleşmiyor.</p>}
          </div>
          {register.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(register.error)}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={register.isPending || !fullName || !email || !password || mismatch || tooShort}>
            {register.isPending ? 'Oluşturuluyor…' : setupRequired ? 'Süper yönetici hesabını oluştur' : 'Hesap oluştur'}
          </Button>
        </form>
        {!setupRequired && (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Zaten hesabınız var mı?{' '}
            <Link href="/giris" className="text-foreground underline-offset-4 hover:underline">
              Giriş yapın
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
