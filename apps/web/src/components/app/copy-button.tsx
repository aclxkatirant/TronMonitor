'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Kopyala', size = 'sm' }: { value: string; label?: string; size?: 'sm' | 'xs' | 'icon-sm' }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Panoya kopyalanamadı. Metni elle seçip kopyalayın.');
    }
  }

  return (
    <Button type="button" variant="outline" size={size} onClick={copy} aria-label={label}>
      {copied ? <Check className="text-status-ok" /> : <Copy />}
      {size !== 'icon-sm' && (copied ? 'Kopyalandı' : label)}
    </Button>
  );
}

export function CommandBlock({ command, label }: { command: string; label?: string }) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2">
        <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">{command}</pre>
        <CopyButton value={command} size="icon-sm" />
      </div>
    </div>
  );
}
