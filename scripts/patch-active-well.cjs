// Sambungkan useActiveWell ke dashboard & well-file agar sumur aktif konsisten.
const fs = require('fs');

// ---------- dashboard ----------
{
  const f = 'apps/web/app/(app)/dashboard/page.tsx';
  let t = fs.readFileSync(f, 'utf8');
  if (!t.includes('useActiveWell')) {
    // import
    const importAnchor = "import { useApi } from '@/lib/hooks/useApi';";
    if (t.includes(importAnchor)) {
      t = t.replace(importAnchor, importAnchor + "\nimport { useActiveWell } from '@/lib/hooks/useActiveWell';");
    }
    // gunakan wellId aktif pada query dashboard
    t = t.replace(
      "const dash = useApi<DashboardPayload>('/api/dashboard');",
      "const activeWell = useActiveWell();\n  // Dashboard mengikuti sumur aktif yang dipilih di topbar (fallback: portofolio).\n  const dash = useApi<DashboardPayload>(activeWell.wellId ? `/api/dashboard?wellId=${activeWell.wellId}` : '/api/dashboard');"
    );
    fs.writeFileSync(f, t, 'utf8');
    console.log('dashboard: useActiveWell dipasang');
  } else console.log('dashboard: sudah ada');
}

// ---------- well-file ----------
{
  const f = 'apps/web/app/(app)/well-file/page.tsx';
  let t = fs.readFileSync(f, 'utf8');
  if (!t.includes('useActiveWell')) {
    const importAnchor = "import { useApi } from '@/lib/hooks/useApi';";
    if (t.includes(importAnchor)) {
      t = t.replace(importAnchor, importAnchor + "\nimport { useActiveWell } from '@/lib/hooks/useActiveWell';");
    }
    t = t.replace(
      "const wells = useApi<WellDto[]>('/api/wells');",
      "const activeWell = useActiveWell();\n  const wells = activeWell.wells;"
    );
    t = t.replace(
      "const wellId = forcedId ?? (wells.data && wells.data.length > 0 ? wells.data[0].id : null);",
      "// Prioritas: ?id= eksplisit, lalu sumur aktif dari topbar.\n  const wellId = forcedId ?? activeWell.wellId;"
    );
    fs.writeFileSync(f, t, 'utf8');
    console.log('well-file: useActiveWell dipasang');
  } else console.log('well-file: sudah ada');
}
