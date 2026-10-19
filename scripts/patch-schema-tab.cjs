// Ganti implementasi SchemaTab dengan komponen WellboreDiagram yang berskala.
const fs = require('fs');

const f = 'apps/web/app/(app)/well-file/page.tsx';
let t = fs.readFileSync(f, 'utf8');

const start = t.indexOf('function SchemaTab(');
if (start === -1) {
  console.log('GAGAL: SchemaTab tidak ditemukan');
  process.exit(1);
}

// Cari akhir fungsi: penanda "function InventoryTab(" sesudahnya.
const nextFn = t.indexOf('function InventoryTab(', start);
if (nextFn === -1) {
  console.log('GAGAL: batas akhir SchemaTab tidak ditemukan');
  process.exit(1);
}

const replacement = `function SchemaTab({ well, latest }: { well: WellDto; latest: ReportListItem | null }) {
  const td = well.tdPlannedM ?? 0;
  const current = well.latestDepthMd ?? latest?.depthMdEnd ?? 0;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Penampang Lubang Bor</h2>
        <span className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Kedalaman kini {current.toFixed(1)} m MD / TD {td.toFixed(0)} m
        </span>
      </div>
      <div style={{ marginTop: 12 }}>
        <WellboreDiagram wellName={well.name} tdPlannedMd={td} currentMd={current} />
      </div>
      <Note kind="info">
        Skala mengikuti TD planned. Lebar pipa mengikuti ukuran casing standar
        (30&quot;/20&quot;/13-3/8&quot;/9-5/8&quot;). Posisi bit mengikuti kedalaman laporan terakhir.
      </Note>
    </Card>
  );
}

`;

t = t.slice(0, start) + replacement + t.slice(nextFn);

// import komponen baru
if (!t.includes("from '@/components/WellboreDiagram'")) {
  const importAnchor = "import { DataTable";
  const idx = t.indexOf(importAnchor);
  if (idx !== -1) {
    t = t.slice(0, idx) + "import { WellboreDiagram } from '@/components/WellboreDiagram';\n" + t.slice(idx);
  } else {
    // fallback: setelah import terakhir
    const lastImport = t.lastIndexOf('\nimport ');
    const endLine = t.indexOf('\n', lastImport + 1);
    t = t.slice(0, endLine + 1) + "import { WellboreDiagram } from '@/components/WellboreDiagram';\n" + t.slice(endLine + 1);
  }
}

fs.writeFileSync(f, t, 'utf8');
console.log('SchemaTab diganti dengan WellboreDiagram');
