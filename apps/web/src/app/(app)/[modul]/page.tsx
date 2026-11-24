import { notFound } from 'next/navigation';
import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { PENDING_MODULES } from '@/lib/navigation';

export function generateStaticParams() {
  return Object.keys(PENDING_MODULES).map((modul) => ({ modul }));
}

export const dynamicParams = false;

export default async function PendingModulePage({ params }: { params: Promise<{ modul: string }> }) {
  const { modul } = await params;
  const info = PENDING_MODULES[modul];
  if (!info) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={info.title} />
      <EmptyState icon={Construction} title="Bu modül henüz etkin değil" description={info.description} />
    </div>
  );
}
