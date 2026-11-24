'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStatus, useLogin } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const status = useAuthStatus();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (status.data?.setupRequired) router.replace('/kurulum');
  }, [status.data, router]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Oturum aç</CardTitle>
        <CardDescription>Altyapınızı yönetmek için hesabınızla giriş yapın.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">E-posta</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ad@kurum.com"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Parola</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {login.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(login.error)}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={login.isPending || !email || !password}>
            {login.isPending ? 'Giriş yapılıyor…' : 'Giriş yap'}
          </Button>
        </form>
        {status.data?.selfRegistrationEnabled && (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Hesabınız yok mu?{' '}
            <Link href="/kurulum" className="text-foreground underline-offset-4 hover:underline">
              Hesap oluşturun
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
