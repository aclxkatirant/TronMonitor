import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-medium">Sayfa bulunamadı</p>
      <p className="max-w-sm text-sm text-muted-foreground">Aradığınız sayfa taşınmış veya hiç var olmamış olabilir.</p>
      <Button asChild variant="outline">
        <Link href="/">Genel Bakış sayfasına dön</Link>
      </Button>
    </div>
  );
}
