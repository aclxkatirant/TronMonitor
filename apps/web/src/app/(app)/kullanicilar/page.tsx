'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, Search, Users } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { hasPermission, useMe } from '@/hooks/use-auth';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ROLE_LABELS, type Paginated, type RoleCatalog, type UserRole, type UserSummary } from '@/lib/types';

const PAGE_SIZE = 25;
const ROLE_OPTIONS: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'];
const ALL_ROLES = '__all__';

function useCatalog(enabled: boolean) {
  return useQuery({ queryKey: ['users', 'catalog'], queryFn: () => api.get<RoleCatalog>('/users/meta/roles'), enabled, staleTime: 5 * 60_000 });
}

interface UserFormState {
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
  isActive: boolean;
  permissions: string[];
}

function PermissionPicker({ catalog, value, onChange, disabled }: { catalog: RoleCatalog | undefined; value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  if (!catalog) return <Skeleton className="h-24 w-full" />;
  return (
    <div className="grid max-h-56 gap-1.5 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
      {catalog.permissions.map((permission) => {
        const checked = value.includes(permission.key);
        return (
          <label key={permission.key} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted">
            <Checkbox
              checked={checked}
              disabled={disabled}
              aria-label={`${permission.key}: ${permission.description}`}
              onCheckedChange={(next) => onChange(next === true ? [...value, permission.key] : value.filter((k) => k !== permission.key))}
              className="mt-0.5"
            />
            <span>
              <span className="block font-mono text-[11px]">{permission.key}</span>
              <span className="block text-muted-foreground">{permission.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function UserDialog({ open, onOpenChange, user, catalog }: { open: boolean; onOpenChange: (open: boolean) => void; user: UserSummary | null; catalog: RoleCatalog | undefined }) {
  const queryClient = useQueryClient();
  const isEdit = user !== null;
  const [form, setForm] = useState<UserFormState>(() => ({
    email: user?.email ?? '',
    fullName: user?.fullName ?? '',
    password: '',
    role: user?.role ?? 'VIEWER',
    isActive: user?.isActive ?? true,
    permissions: user?.permissions ?? [],
  }));

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const payload: Record<string, unknown> = { fullName: form.fullName, role: form.role, isActive: form.isActive, permissions: form.permissions };
        if (form.password) payload.newPassword = form.password;
        return api.patch<UserSummary>(`/users/${user.id}`, payload);
      }
      return api.post<UserSummary>('/users', { email: form.email, fullName: form.fullName, password: form.password, role: form.role, permissions: form.permissions });
    },
    onSuccess: async () => {
      toast.success(isEdit ? 'Kullanıcı güncellendi.' : 'Kullanıcı oluşturuldu.');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onOpenChange(false);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  const showsExplicitPermissions = form.role === 'OPERATOR' || form.role === 'VIEWER';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Kullanıcıyı düzenle' : 'Yeni kullanıcı'}</DialogTitle>
            <DialogDescription>{isEdit ? user.email : 'Kullanıcı bilgilerini ve rolünü belirleyin.'}</DialogDescription>
          </DialogHeader>

          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="u-email">E-posta</Label>
              <Input id="u-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoFocus />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Ad soyad</Label>
            <Input id="u-name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-password">{isEdit ? 'Yeni parola (isteğe bağlı)' : 'Parola'}</Label>
            <Input id="u-password" type="password" autoComplete="new-password" required={!isEdit} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <p className="text-xs text-muted-foreground">{isEdit ? 'Doldurulursa parola sıfırlanır ve kullanıcının tüm oturumları kapatılır.' : 'En az 12 karakter; harf ve rakam içermeli.'}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="u-role">Rol</Label>
              <Select value={form.role} onValueChange={(value) => setForm({ ...form, role: value as UserRole })}>
                <SelectTrigger id="u-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isEdit && (
              <div className="space-y-1.5">
                <Label htmlFor="u-active">Hesap durumu</Label>
                <div className="flex h-8 items-center gap-2">
                  <Switch id="u-active" checked={form.isActive} onCheckedChange={(checked) => setForm({ ...form, isActive: checked })} />
                  <span className="text-sm">{form.isActive ? 'Etkin' : 'Devre dışı'}</span>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Ek izinler</Label>
            <p className="text-xs text-muted-foreground">
              {showsExplicitPermissions
                ? 'Rolün varsayılan izinlerine ek olarak bu kullanıcıya açıkça verilen izinler.'
                : 'Yönetici rolleri zaten geniş yetkiye sahiptir; ek izinler yalnızca Operatör ve İzleyici için anlamlıdır.'}
            </p>
            <PermissionPicker catalog={catalog} value={form.permissions} onChange={(permissions) => setForm({ ...form, permissions })} disabled={!showsExplicitPermissions} />
          </div>

          {mutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={mutation.isPending || !form.fullName || (!isEdit && (!form.email || !form.password))}>
              {mutation.isPending ? 'Kaydediliyor…' : isEdit ? 'Kaydet' : 'Oluştur'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const me = useMe();
  const canManage = hasPermission(me.data, 'users.manage');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [role, setRole] = useState<string>(ALL_ROLES);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ open: boolean; user: UserSummary | null; key: number }>({ open: false, user: null, key: 0 });

  const catalog = useCatalog(canManage);
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (submittedSearch) params.set('search', submittedSearch);
  if (role !== ALL_ROLES) params.set('role', role);

  const users = useQuery({
    queryKey: ['users', 'list', params.toString()],
    queryFn: () => api.get<Paginated<UserSummary>>(`/users?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const totalPages = users.data ? Math.max(1, Math.ceil(users.data.total / PAGE_SIZE)) : 1;

  // `key` her açılışta artar; böylece iletişim kutusu formu temiz başlangıç durumuyla yeniden kurulur.
  function openCreate() {
    setDialog((d) => ({ open: true, user: null, key: d.key + 1 }));
  }
  function openEdit(user: UserSummary) {
    setDialog((d) => ({ open: true, user, key: d.key + 1 }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kullanıcılar"
        description="Platforma erişimi olan hesaplar ve yetkileri."
        actions={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus /> Yeni kullanıcı
            </Button>
          ) : undefined
        }
      />

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSubmittedSearch(search.trim());
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ad veya e-posta ara…" className="pl-8" aria-label="Kullanıcı ara" />
        </div>
        <Select
          value={role}
          onValueChange={(value) => {
            setRole(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Rol filtresi">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ROLES}>Tüm roller</SelectItem>
            {ROLE_OPTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {ROLE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline">
          Ara
        </Button>
      </form>

      {users.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : users.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(users.error)}</AlertDescription>
        </Alert>
      ) : users.data.items.length === 0 ? (
        <EmptyState icon={Users} title="Kullanıcı bulunamadı" description={submittedSearch || role !== ALL_ROLES ? 'Filtreyle eşleşen kullanıcı yok.' : 'Henüz kullanıcı eklenmemiş.'} />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kullanıcı</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Son giriş</TableHead>
                <TableHead>Oluşturulma</TableHead>
                {canManage && <TableHead className="text-right">İşlem</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.items.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <span className="block font-medium">{user.fullName}</span>
                    <span className="block text-xs text-muted-foreground">{user.email}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{user.roleLabel}</Badge>
                    {user.permissions.length > 0 && <span className="ml-1.5 text-xs text-muted-foreground">+{user.permissions.length} izin</span>}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-sm">
                      <span className={user.isActive ? 'size-2 rounded-full bg-status-ok' : 'size-2 rounded-full bg-status-neutral'} aria-hidden />
                      {user.isActive ? 'Etkin' : 'Devre dışı'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{formatDateTime(user.lastLoginAt)}</TableCell>
                  <TableCell className="text-sm">{formatDateTime(user.createdAt)}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(user)} aria-label={`${user.fullName} kullanıcısını düzenle`}>
                        <Pencil /> Düzenle
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {users.data && users.data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Toplam {users.data.total} kullanıcı · Sayfa {page}/{totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Önceki
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Sonraki
            </Button>
          </div>
        </div>
      )}

      {dialog.open && <UserDialog key={dialog.key} open={dialog.open} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} user={dialog.user} catalog={catalog.data} />}
    </div>
  );
}
