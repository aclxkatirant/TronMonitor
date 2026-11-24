'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { ColorDot } from '@/components/app/status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useGroups, useTags } from '@/hooks/use-servers';
import { api, errorMessage } from '@/lib/api';
import type { ServerGroup } from '@/lib/types';

const PALETTE = ['#22c55e', '#0ea5e9', '#a855f7', '#f59e0b', '#ef4444', '#64748b'];

function ColorPicker({ value, onChange, idPrefix }: { value: string; onChange: (color: string) => void; idPrefix: string }) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Renk">
      {PALETTE.map((color) => (
        <button
          key={color}
          id={`${idPrefix}-${color.slice(1)}`}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          onClick={() => onChange(color)}
          className="flex size-6 items-center justify-center rounded-full border-2 transition-colors"
          style={{ borderColor: value === color ? 'var(--foreground)' : 'transparent', backgroundColor: color }}
        />
      ))}
    </div>
  );
}

function GroupsCard() {
  const queryClient = useQueryClient();
  const groups = useGroups();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [editing, setEditing] = useState<ServerGroup | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editColor, setEditColor] = useState(PALETTE[0]);
  const invalidate = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['servers'] })]);

  const create = useMutation({
    mutationFn: () => api.post<ServerGroup>('/server-groups', { name: name.trim(), description: description.trim() || null, color }),
    onSuccess: async () => {
      toast.success('Grup oluşturuldu.');
      setName('');
      setDescription('');
      await invalidate();
    },
  });
  const update = useMutation({
    mutationFn: () => api.patch<ServerGroup>(`/server-groups/${editing!.id}`, { name: editName.trim(), description: editDescription.trim() || null, color: editColor }),
    onSuccess: async () => {
      toast.success('Grup güncellendi.');
      setEditing(null);
      await invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/server-groups/${id}`),
    onSuccess: async () => {
      toast.success('Grup silindi; sunucular gruptan çıkarıldı.');
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function openEdit(group: ServerGroup) {
    setEditing(group);
    setEditName(group.name);
    setEditDescription(group.description ?? '');
    setEditColor(group.color ?? PALETTE[0]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sunucu grupları</CardTitle>
        <CardDescription>Sunucuları ortam veya konuma göre gruplayın. Bir sunucu yalnızca bir gruba ait olabilir.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="g-name">Grup adı</Label>
            <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Üretim" maxLength={80} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-desc">Açıklama</Label>
            <Input id="g-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>
          <div className="space-y-1.5">
            <Label>Renk</Label>
            <ColorPicker value={color} onChange={setColor} idPrefix="g-color" />
          </div>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            <Plus /> Ekle
          </Button>
          {create.isError && (
            <Alert variant="destructive" className="sm:col-span-4">
              <AlertDescription>{errorMessage(create.error)}</AlertDescription>
            </Alert>
          )}
        </form>

        {groups.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : groups.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(groups.error)}</AlertDescription>
          </Alert>
        ) : groups.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz grup yok.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {groups.data.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-3 py-2">
                <ColorDot color={g.color} className="size-2.5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{g.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{g.description || `${g.serverCount} sunucu`}</span>
                </span>
                <span className="text-xs text-muted-foreground">{g.serverCount} sunucu</span>
                <Button variant="ghost" size="icon-sm" aria-label={`${g.name} grubunu düzenle`} onClick={() => openEdit(g)}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`${g.name} grubunu sil`} disabled={remove.isPending} onClick={() => remove.mutate(g.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Grubu düzenle</DialogTitle>
              <DialogDescription>{editing?.name}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="ge-name">Grup adı</Label>
              <Input id="ge-name" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={80} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ge-desc">Açıklama</Label>
              <Input id="ge-desc" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} maxLength={500} />
            </div>
            <div className="space-y-1.5">
              <Label>Renk</Label>
              <ColorPicker value={editColor} onChange={setEditColor} idPrefix="ge-color" />
            </div>
            {update.isError && (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(update.error)}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Vazgeç
              </Button>
              <Button type="submit" disabled={update.isPending || !editName.trim()}>
                Kaydet
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TagsCard() {
  const queryClient = useQueryClient();
  const tags = useTags();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[1]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['servers'] });

  const create = useMutation({
    mutationFn: () => api.post('/tags', { name: name.trim(), color }),
    onSuccess: async () => {
      toast.success('Etiket oluşturuldu.');
      setName('');
      await invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/tags/${id}`),
    onSuccess: async () => {
      toast.success('Etiket silindi.');
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Etiketler</CardTitle>
        <CardDescription>Bir sunucuya birden çok etiket verilebilir (ör. web, veritabanı, kritik).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="t-name">Etiket adı</Label>
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. veritabanı" maxLength={40} required />
          </div>
          <div className="space-y-1.5">
            <Label>Renk</Label>
            <ColorPicker value={color} onChange={setColor} idPrefix="t-color" />
          </div>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            <Plus /> Ekle
          </Button>
          {create.isError && (
            <Alert variant="destructive" className="sm:col-span-3">
              <AlertDescription>{errorMessage(create.error)}</AlertDescription>
            </Alert>
          )}
        </form>

        {tags.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : tags.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(tags.error)}</AlertDescription>
          </Alert>
        ) : tags.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz etiket yok.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {tags.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                <ColorDot color={t.color} className="size-2.5" />
                <span className="flex-1 text-sm font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.serverCount} sunucu</span>
                <Button variant="ghost" size="icon-sm" aria-label={`${t.name} etiketini sil`} disabled={remove.isPending} onClick={() => remove.mutate(t.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function GroupsAndTagsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Gruplar ve etiketler"
        description="Sunucuları düzenlemek için gruplar ve etiketler."
        actions={
          <Button asChild variant="ghost">
            <Link href="/sunucular">
              <ArrowLeft /> Sunuculara dön
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupsCard />
        <TagsCard />
      </div>
    </div>
  );
}
