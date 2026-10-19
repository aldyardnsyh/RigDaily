// Tambah wellCode + division ke API wells (create, patch, payload).
const fs = require('fs');
const NL = String.fromCharCode(10);

/* ---------- create route ---------- */
{
  const f = 'apps/web/app/api/wells/route.ts';
  let t = fs.readFileSync(f, 'utf8');

  if (!t.includes('wellCode: z.string()')) {
    t = t.replace(
      "    name: z.string().trim().min(1, 'Nama sumur wajib diisi').max(160),",
      "    /** WELL ID: kode unik internal operator. */" + NL +
        "    wellCode: z.string().trim().max(60).nullable().optional()," + NL +
        "    name: z.string().trim().min(1, 'Nama sumur wajib diisi').max(160)," + NL +
        '    /** DIVISION: unit bisnis pemilik sumur. */' + NL +
        '    division: z.string().trim().max(120).nullable().optional(),'
    );
  }
  if (!t.includes('wellCode: body.wellCode')) {
    t = t.replace(
      '    const created = await createWell({' + NL + '      name: body.name,',
      '    const created = await createWell({' + NL + '      wellCode: body.wellCode ?? null,' + NL + '      name: body.name,' + NL + '      division: body.division ?? null,'
    );
  }
  // payload GET list juga
  if (!t.includes('wellCode: well.wellCode')) {
    t = t.replace(
      '      apiNo: well.apiNo,',
      '      wellCode: well.wellCode,' + NL + '      division: well.division,' + NL + '      apiNo: well.apiNo,'
    );
  }
  fs.writeFileSync(f, t, 'utf8');
  console.log('api/wells: wellCode + division');
}

/* ---------- [id] route ---------- */
{
  const f = 'apps/web/app/api/wells/[id]/route.ts';
  let t = fs.readFileSync(f, 'utf8');

  const p = t.indexOf('const zPatch');
  if (p !== -1) {
    // tambah field ke schema patch bila ada objek zod
    if (!t.includes('wellCode:')) {
      t = t.replace(/(const zPatch[^\n]*\n(?:[^\n]*\n)*?\s*)name:/, '$1wellCode: z.string().trim().max(60).nullable().optional(),\n    division: z.string().trim().max(120).nullable().optional(),\n    name:');
    }
  }
  fs.writeFileSync(f, t, 'utf8');
  console.log('api/wells/[id] diproses');
}
