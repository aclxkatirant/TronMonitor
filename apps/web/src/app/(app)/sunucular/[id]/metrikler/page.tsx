'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { ServerStatusBadge } from '@/components/app/status';
import { RangePicker, type RangeSelection } from '@/components/charts/range-picker';
import { ServerMetricsPanel } from '@/components/charts/server-metrics-panel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useServer } from '@/hooks/use-servers';
import { errorMessage } from '@/lib/api';

export default function ServerMetricsPage() {
  const params = useParams<{ id: string }>();
  const server = useServer(params.id);
  const [selection, setSelection] = useState<RangeSelection>({ range: '1h' });

  if (server.isPending) return <Skeleton className="h-96 w-full" />;
  if (server.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(server.error)}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${server.data.name} · Metrikler`}
        description={server.data.hostname ?? undefined}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/sunucular/${server.data.id}`}>
              <ArrowLeft /> Sunucu ayrıntısı
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker value={selection} onChange={setSelection} />
        <ServerStatusBadge status={server.data.status} />
      </div>
      <ServerMetricsPanel serverId={server.data.id} osFamily={server.data.osFamily} selection={selection} />
    </div>
  );
}
