// Tambah kolom Aksi (Edit / Nonaktifkan / Hapus) pada tabel pengguna di Admin.
const fs = require('fs');
const NL = String.fromCharCode(10);
const f = 'apps/web/app/(app)/admin/page.tsx';
let t = fs.readFileSync(f, 'utf8');

// --- 1. State untuk modal edit user ---
if (!t.includes('userEditTarget')) {
  t = t.replace(
    '  const loading = users.loading;',
    [
      '  const loading = users.loading;',
      '',
      '  /* ---------- CRUD pengguna: edit & hapus ---------- */',
      '  const [userEditTarget, setUserEditTarget] = useState<UserDto | null>(null);',
      '  const [userEditForm, setUserEditForm] = useState({ name: \'\', email: \'\', role: \'Viewer\', active: true });',
      '  const [userBusyId, setUserBusyId] = useState<string | null>(null);',
      '  const [deleteTarget, setDeleteTarget] = useState<UserDto | null>(null);',
      '',
      '  async function saveUserEdit() {',
      '    if (!userEditTarget) return;',
      '    if (userEditForm.name.trim().length < 2) {',
      '      toast.error(\'Nama minimal 2 karakter.\');',
      '      return;',
      '    }',
      '    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(userEditForm.email.trim())) {',
      '      toast.error(\'Format email belum valid.\');',
      '      return;',
      '    }',
      '    setUserBusyId(userEditTarget.id);',
      '    try {',
      '      await apiSend(\'/api/admin/users\', \'PATCH\', {',
      '        id: userEditTarget.id,',
      '        name: userEditForm.name.trim(),',
      '        email: userEditForm.email.trim().toLowerCase(),',
      '        role: userEditForm.role,',
      '        active: userEditForm.active,',
      '      });',
      '      toast.success(`Pengguna ${userEditForm.name.trim()} diperbarui.`);',
      '      setUserEditTarget(null);',
      '      users.reload();',
      '    } catch (err) {',
      '      toast.error(err instanceof Error ? err.message : \'Gagal memperbarui pengguna.\');',
      '    } finally {',
      '      setUserBusyId(null);',
      '    }',
      '  }',
      '',
      '  async function deleteUser() {',
      '    if (!deleteTarget) return;',
      '    setUserBusyId(deleteTarget.id);',
      '    try {',
      '      await apiSend(`/api/admin/users?id=${deleteTarget.id}`, \'DELETE\');',
      '      toast.success(`Pengguna ${deleteTarget.name} dihapus dan sesinya dicabut.`);',
      '      setDeleteTarget(null);',
      '      users.reload();',
      '    } catch (err) {',
      '      toast.error(err instanceof Error ? err.message : \'Gagal menghapus pengguna.\');',
      '    } finally {',
      '      setUserBusyId(null);',
      '    }',
      '  }',
      '',
      '  async function toggleUserActive(u: UserDto) {',
      '    setUserBusyId(u.id);',
      '    try {',
      '      await apiSend(\'/api/admin/users\', \'PATCH\', { id: u.id, active: !u.active });',
      '      toast.success(`Status ${u.name}: ${u.active ? \'dinonaktifkan\' : \'diaktifkan\'}.`);',
      '      users.reload();',
      '    } catch (err) {',
      '      toast.error(err instanceof Error ? err.message : \'Gagal mengubah status.\');',
      '    } finally {',
      '      setUserBusyId(null);',
      '    }',
      '  }',
    ].join(NL)
  );
}

// --- 2. Kolom Aksi di akhir array columns ---
const columnsEnd = `    {
      key: 'active',
      header: 'Status',
      render: (u) => (
        <span
          style={{
            borderRadius: 999,
            padding: '2px 10px',
            fontSize: 11,
            fontWeight: 700,
            background: u.active ? 'var(--success-soft)' : 'var(--bg-surface-2)',
            color: u.active ? 'var(--success)' : 'var(--text-secondary)',
          }}
        >
          {u.active ? 'Aktif' : 'Nonaktif'}
        </span>
      ),
    },
  ];`;

const columnsEndNew = `    {
      key: 'active',
      header: 'Status',
      render: (u) => (
        <span
          style={{
            borderRadius: 999,
            padding: '2px 10px',
            fontSize: 11,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            background: u.active ? 'var(--success-soft)' : 'var(--bg-surface-2)',
            color: u.active ? 'var(--success)' : 'var(--text-secondary)',
          }}
        >
          {u.active ? 'Aktif' : 'Nonaktif'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      align: 'right',
      width: 132,
      render: (u) => (
        <span style={{ display: 'inline-flex', gap: 4, justifyContent: 'flex-end' }}>
          <Button
            variant="tertiary"
            size="sm"
            aria-label={\`Edit \${u.name}\`}
            title="Edit nama, email, role, status"
            disabled={!canManage || userBusyId === u.id}
            onClick={() => {
              setUserEditForm({ name: u.name, email: u.email, role: u.role, active: u.active });
              setUserEditTarget(u);
            }}
          >
            <Pencil size={14} />
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            aria-label={\`\${u.active ? 'Nonaktifkan' : 'Aktifkan'} \${u.name}\`}
            title={u.active ? 'Nonaktifkan akun' : 'Aktifkan akun'}
            disabled={!canManage || userBusyId === u.id}
            onClick={() => toggleUserActive(u)}
          >
            <SlidersHorizontal size={14} />
          </Button>
          <Button
            variant="danger-ghost"
            size="sm"
            aria-label={\`Hapus \${u.name}\`}
            title="Hapus akun (soft delete) dan cabut semua sesinya"
            disabled={!canManage || userBusyId === u.id}
            onClick={() => setDeleteTarget(u)}
          >
            <Trash2 size={14} />
          </Button>
        </span>
      ),
    },
  ];`;

if (!t.includes(columnsEnd)) {
  console.log('GAGAL: kolom status pengguna tidak ditemukan');
  process.exit(1);
}
t = t.replace(columnsEnd, columnsEndNew);

fs.writeFileSync(f, t, 'utf8');
console.log('Admin: kolom Aksi pengguna ditambahkan');
