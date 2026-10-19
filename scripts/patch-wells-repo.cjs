// Tambah wellCode + division ke tipe input dan implementasi repo wells.
const fs = require('fs');
const NL = String.fromCharCode(10);
const f = 'apps/web/lib/repo/wells.ts';
let t = fs.readFileSync(f, 'utf8');

// 1. WellCreateInput
t = t.replace(
  'export type WellCreateInput = {' + NL + '  name: string;',
  'export type WellCreateInput = {' + NL +
    '  /** WELL ID: kode unik internal operator. */' + NL +
    '  wellCode?: string | null;' + NL +
    '  name: string;' + NL +
    '  /** DIVISION: unit bisnis pemilik sumur. */' + NL +
    '  division?: string | null;'
);

// 2. insert values
t = t.replace(
  '      type: input.type,' + NL + '      phase: input.phase,',
  '      wellCode: input.wellCode?.trim() || null,' + NL +
    '      division: input.division?.trim() || null,' + NL +
    '      type: input.type,' + NL + '      phase: input.phase,'
);

// 3. updateWellDetails patch type
t = t.replace(
  '  patch: {' + NL + '    name?: string;' + NL + '    apiNo?: string | null;',
  '  patch: {' + NL +
    '    wellCode?: string | null;' + NL +
    '    name?: string;' + NL +
    '    division?: string | null;' + NL +
    '    apiNo?: string | null;'
);

fs.writeFileSync(f, t, 'utf8');
console.log('repo wells: wellCode + division ditambahkan');
