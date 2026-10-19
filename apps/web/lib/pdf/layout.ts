/**
 * Helper layout PDF bersama - SERVER ONLY.
 *
 * Gaya: hitam-putih dominan (hemat tinta), aksen hanya garis tebal.
 * Font: Helvetica / Helvetica-Bold (built-in pdfkit, tanpa file font eksternal).
 *
 * Catatan penting:
 * - `bufferPages: true` + `switchToPage` dipakai agar footer "Page X of Y" bisa
 *   ditulis SETELAH seluruh isi selesai (jumlah halaman final diketahui).
 * - Helvetica built-in memakai encoding WinAnsi (bukan Unicode penuh). Semua teks
 *   yang masuk ke dokumen WAJIB lewat `ascii()` agar glyph non-Latin-1 tidak
 *   merusak output (mis. em-dash "-", kurung kutip keriting, dsb).
 */
import 'server-only';
import PDFDocument from 'pdfkit';

export type Doc = PDFKit.PDFDocument;

/** Warna dasar dokumen (monokrom + aksen tipis). */
export const COLORS = {
  ink: '#000000',
  rule: '#000000',
  muted: '#555555',
  accent: '#0F2A44',
  danger: '#B91C1C',
  ok: '#047857',
  fill: '#F2F3FF',
} as const;

/** Margin A4 (pt). */
const MARGIN = 36;
/** Tinggi area footer + jarak aman dari tepi bawah. */
const FOOTER_HEIGHT = 24;

/* ------------------------------------------------------------------ */
/* Metadata footer (disimpan di objek doc agar bisa dilukis belakangan) */
/* ------------------------------------------------------------------ */

type FooterMeta = {
  generatedAt: string;
  footnote: string;
  /** true untuk mode landscape (IADC). */
  landscape: boolean;
  /** Padding horizontal kiri/kanan (pt). */
  margin: number;
};

type DocWithFooter = Doc & { __rigFooter?: FooterMeta };

const GENERATED_AT = () => new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

const DEFAULT_FOOTNOTE = 'IADC-compatible format - bukan IADC Certified';

/* ------------------------------------------------------------------ */
/* Sanitasi teks (WinAnsi-safe)                                        */
/* ------------------------------------------------------------------ */

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[\u2013\u2014\u2015\u2212]/g, '-'], // dash
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"], // kutip tunggal
  [/[\u201C\u201D\u201E\u201F\u2033]/g, '"'], // kutip ganda
  [/[\u2026]/g, '...'], // ellipsis
  [/[\u00A0\u2007\u202F\u2009\u200A\u2002\u2003]/g, ' '], // spasi khusus
  [/[\u2192]/g, '->'],
  [/[\u2190]/g, '<-'],
  [/[\u00D7]/g, 'x'], // tanda kali
  [/[\u2022\u25CF\u25AA\u00B7\u2023]/g, '-'], // bullet
  [/[\u2264]/g, '<='],
  [/[\u2265]/g, '>='],
  [/[\u2260]/g, '!='],
  [/[\u00B0]/g, ' deg'], // derajat
  [/[\u00B5]/g, 'u'], // micro
  [/[\u03C0]/g, 'pi'],
  [/\u00A9/g, '(c)'],
  [/\u00AE/g, '(R)'],
];

/**
 * Ubah teks menjadi aman untuk Helvetica built-in (WinAnsi). Karakter di luar
 * Latin-1 yang tidak dipetakan akan diganti '?' agar tidak jadi kotak/rusak.
 * Tahan data "mojibake" (mis. "-") yang mungkin masuk dari seed lama.
 */
export function ascii(input: string | null | undefined): string {
  if (input === null || input === undefined) return '';
  let out = repairMojibake(String(input));
  for (const [re, rep] of REPLACEMENTS) out = out.replace(re, rep);
  // Sisakan hanya karakter printable Latin-1 + newline + tab. Buang kontrol,
  // juga glyph box-drawing / latin-extended yang tidak ada di WinAnsi.
  out = out.replace(/[^\t\n\x20-\x7E\xA0-\xFF]/g, '?');
  return out;
}

/**
 * Perbaiki teks UTF-8 yang salah di-decode sebagai Windows-1252 (mojibake),
 * mis. "-" (= em-dash) atau "“" (kutip keriting). Bila bukan mojibake
 * (tidak ada karakter C1 / rentang CP1252 khusus), teks dikembalikan apa adanya.
 */
const CP1252_REVERSE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

function repairMojibake(str: string): string {
  // Tidak ada karakter CP1252 khas mojibake -> lewati.
  if (!/[\u00C2\u00C3\u00E2\u00F0]/.test(str)) return str;
  const bytes: number[] = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0xff) bytes.push(cp);
    else if (CP1252_REVERSE[cp] !== undefined) bytes.push(CP1252_REVERSE[cp]);
    else return str; // karakter di luar jangkauan -> bukan mojibake yang bisa dipulihkan
  }
  try {
    const decoded = Buffer.from(bytes).toString('utf8');
    // Anggap perbaikan berhasil bila tidak menghasilkan replacement char.
    if (decoded.includes('\uFFFD')) return str;
    return decoded;
  } catch {
    return str;
  }
}

/* ------------------------------------------------------------------ */
/* Pembuatan dokumen & konversi                                        */
/* ------------------------------------------------------------------ */

export function createDoc(): Doc {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN + FOOTER_HEIGHT, left: MARGIN, right: MARGIN },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: 'RigDaily Report',
      Author: 'RigDaily',
      Subject: 'IADC-compatible daily report (bukan IADC Certified)',
    },
  }) as DocWithFooter;

  doc.__rigFooter = {
    generatedAt: GENERATED_AT(),
    footnote: DEFAULT_FOOTNOTE,
    landscape: false,
    margin: MARGIN,
  };

  // Letak baseline agar Helvetica rapi.
  doc.lineGap(1);
  return doc;
}

/** Buat dokumen A4 LANDSCAPE langsung (halaman pertama sudah landscape). */
export function createDocLandscape(): Doc {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: MARGIN, bottom: MARGIN + FOOTER_HEIGHT, left: MARGIN, right: MARGIN },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: 'RigDaily IADC Time Sheet',
      Author: 'RigDaily',
      Subject: 'IADC-compatible daily time sheet (bukan IADC Certified)',
    },
  }) as DocWithFooter;

  doc.__rigFooter = {
    generatedAt: GENERATED_AT(),
    footnote: DEFAULT_FOOTNOTE,
    landscape: true,
    margin: MARGIN,
  };

  doc.lineGap(1);
  return doc;
}

/** Atur teks catatan kaki footer (mis. nomor DDR). */
export function setFootnote(doc: Doc, text: string): void {
  const d = doc as DocWithFooter;
  if (d.__rigFooter) d.__rigFooter.footnote = ascii(text);
}

/**
 * Lukis footer pada SETIAP halaman (Page X of Y, timestamp, disclaimer).
 * Dipanggil dari `docToBuffer` saat semua isi sudah selesai.
 */
function paintFooters(doc: Doc): void {
  const d = doc as DocWithFooter;
  const meta = d.__rigFooter;
  if (!meta) return;

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);

    const { width, height } = doc.page;
    // pdfkit memindah cursor saat switchToPage; simpan & pulihkan marjin bawah agar
    // penulisan footer tidak memicu halaman baru.
    const margins = doc.page.margins;
    const savedBottom = margins.bottom;
    margins.bottom = 0;

    const y = height - MARGIN - FOOTER_HEIGHT + 6;
    const left = meta.margin;
    const right = width - meta.margin;

    doc
      .save()
      .strokeColor(COLORS.rule)
      .lineWidth(0.5)
      .moveTo(left, y - 4)
      .lineTo(right, y - 4)
      .stroke()
      .restore();

    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted);

    const pageLabel = `Page ${i - range.start + 1} of ${range.count}`;
    doc.text(ascii(pageLabel), left, y, { width: right - left, align: 'right', lineBreak: false });

    doc.text(`Generated ${meta.generatedAt}`, left, y, { width: (right - left) / 2, align: 'left', lineBreak: false });

    const footnote = meta.footnote ? `${meta.footnote}  |  ` : '';
    doc.text(ascii(`${footnote}${DEFAULT_FOOTNOTE}`), left, y + 8, { width: right - left, align: 'center', lineBreak: false });

    margins.bottom = savedBottom;
  }

  // Kembali ke halaman terakhir.
  if (range.count > 0) doc.switchToPage(range.start + range.count - 1);
}

export function docToBuffer(doc: Doc): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      paintFooters(doc);
    } catch (err) {
      reject(err);
      return;
    }

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/* ------------------------------------------------------------------ */
/* Primitif layout                                                     */
/* ------------------------------------------------------------------ */

const CONTENT_WIDTH = (doc: Doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const CONTENT_LEFT = (doc: Doc) => doc.page.margins.left;

/** Pastikan ada ruang `needed` pt; pindah halaman bila tidak cukup. */
export function ensureSpace(doc: Doc, needed: number): void {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottomLimit) {
    doc.addPage();
  }
}

/** Header dokumen: kotak judul + baris meta (Report No, Date, Well, Rig, Period). */
export function header(
  doc: Doc,
  opts: { title: string; subtitle: string; reportNo: number; reportDate: string; wellName: string; rigName: string; period?: string },
): void {
  const left = CONTENT_LEFT(doc);
  const width = CONTENT_WIDTH(doc);

  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.ink);
  doc.text(ascii(opts.title), left, doc.page.margins.top, { width, align: 'left', lineBreak: false });

  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted);
  doc.text(ascii(opts.subtitle), left, doc.y + 1, { width, align: 'left', lineBreak: false });

  // Garis tebal aksen (satu-satunya elemen "berwarna tebal").
  const ruleY = doc.y + 6;
  doc.save().strokeColor(COLORS.accent).lineWidth(2.5).moveTo(left, ruleY).lineTo(left + width, ruleY).stroke().restore();

  doc.y = ruleY + 8;

  const period = opts.period ?? '06:00-06:00';
  const items: Array<{ k: string; v: string }> = [
    { k: 'Report No', v: `#${opts.reportNo}` },
    { k: 'Date', v: opts.reportDate },
    { k: 'Well', v: opts.wellName },
    { k: 'Rig', v: opts.rigName },
    { k: 'Period', v: period },
  ];
  kvGrid(doc, items, 5);
}

/** Judul seksi bernomor, mis. "01 General Information & Progress". */
export function sectionTitle(doc: Doc, text: string): void {
  ensureSpace(doc, 26);
  const left = CONTENT_LEFT(doc);
  const width = CONTENT_WIDTH(doc);

  doc.y += 6;
  const y = doc.y;

  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink);
  doc.text(ascii(text), left, y, { width, align: 'left', lineBreak: false });

  const ruleY = y + 13;
  doc.save().strokeColor(COLORS.rule).lineWidth(0.7).moveTo(left, ruleY).lineTo(left + width, ruleY).stroke().restore();

  doc.y = ruleY + 4;
}

/** Grid label/nilai (label kecil di atas nilai). */
export function kvGrid(doc: Doc, items: Array<{ k: string; v: string }>, cols = 3): void {
  const left = CONTENT_LEFT(doc);
  const width = CONTENT_WIDTH(doc);
  const gap = 8;
  const colW = (width - gap * (cols - 1)) / cols;
  const rows = Math.ceil(items.length / cols);

  const top = doc.y;
  let maxBottom = top;

  for (let r = 0; r < rows; r += 1) {
    const rowTop = top + r * 24;
    for (let c = 0; c < cols; c += 1) {
      const item = items[r * cols + c];
      if (!item) continue;
      const x = left + c * (colW + gap);

      doc.font('Helvetica').fontSize(6.5).fillColor(COLORS.muted);
      doc.text(ascii(item.k).toUpperCase(), x, rowTop, { width: colW, lineBreak: false, ellipsis: true });

      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink);
      doc.text(ascii(item.v), x, rowTop + 9, { width: colW, lineBreak: false, ellipsis: true });

      maxBottom = Math.max(maxBottom, rowTop + 22);
    }
  }

  doc.y = maxBottom + 4;
}

type TableColumn = { header: string; width: number; align?: 'left' | 'right' | 'center'; key: string };

type TableOpts = {
  columns: TableColumn[];
  rows: Array<Record<string, string>>;
  rowHeight?: number;
  tint?: (row: Record<string, string>, index: number) => string | null;
};

const PAD_X = 3;
const PAD_Y = 3;

/**
 * Tabel generik. Header baris diulang di setiap halaman baru. Tinggi baris
 * otomatis mengikuti teks terpanjang (wrap + ellipsis) kecuali `rowHeight` diisi.
 */
export function table(doc: Doc, opts: TableOpts): void {
  const left = CONTENT_LEFT(doc);
  const headerFontSize = 7;
  const bodyFontSize = 7.5;

  const headerHeight = 14;

  const drawHead = (y: number): number => {
    doc.save().rect(left, y, CONTENT_WIDTH(doc), headerHeight).fill(COLORS.ink).restore();
    doc.font('Helvetica-Bold').fontSize(headerFontSize).fillColor('#FFFFFF');
    let x = left;
    for (const col of opts.columns) {
      doc.text(ascii(col.header), x + PAD_X, y + 4, {
        width: col.width - PAD_X * 2,
        align: col.align ?? 'left',
        lineBreak: false,
        ellipsis: true,
      });
      x += col.width;
    }
    return y + headerHeight;
  };

  ensureSpace(doc, headerHeight + 20);
  let y = drawHead(doc.y);

  opts.rows.forEach((row, index) => {
    // Ukur tinggi baris (multi-baris bila teks panjang).
    doc.font('Helvetica').fontSize(bodyFontSize);
    let contentHeight = 0;
    for (const col of opts.columns) {
      const cell = ascii(row[col.key] ?? '');
      const h = doc.heightOfString(cell || ' ', { width: col.width - PAD_X * 2 });
      contentHeight = Math.max(contentHeight, h);
    }
    const rowHeight = opts.rowHeight ?? Math.max(14, contentHeight + PAD_Y * 2);

    // Pindah halaman bila perlu (ulangi header tabel).
    const bottomLimit = doc.page.height - doc.page.margins.bottom;
    if (y + rowHeight > bottomLimit) {
      doc.addPage();
      y = drawHead(doc.y);
    }

    const tint = opts.tint ? opts.tint(row, index) : null;
    if (tint) {
      doc.save().rect(left, y, CONTENT_WIDTH(doc), rowHeight).fill(tint).restore();
    }

    doc.save().strokeColor(COLORS.muted).lineWidth(0.3);
    doc.moveTo(left, y + rowHeight).lineTo(left + CONTENT_WIDTH(doc), y + rowHeight).stroke().restore();

    doc.font('Helvetica').fontSize(bodyFontSize).fillColor(COLORS.ink);
    let x = left;
    for (const col of opts.columns) {
      doc.text(ascii(row[col.key] ?? ''), x + PAD_X, y + PAD_Y, {
        width: col.width - PAD_X * 2,
        align: col.align ?? 'left',
        lineBreak: true,
        ellipsis: true,
      });
      x += col.width;
    }

    y += rowHeight;
  });

  // Garis penutup tabel.
  doc.save().strokeColor(COLORS.rule).lineWidth(0.7).moveTo(left, y).lineTo(left + CONTENT_WIDTH(doc), y).stroke().restore();
  doc.y = y + 6;
}

/** Kotak catatan (info / warning / error). Warna tipis, teks tetap hitam. */
export function note(doc: Doc, text: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
  const accent = kind === 'error' ? COLORS.danger : kind === 'warn' ? '#B45309' : COLORS.accent;
  const left = CONTENT_LEFT(doc);
  const width = CONTENT_WIDTH(doc);
  const body = ascii(text);

  doc.font('Helvetica').fontSize(8);
  const innerWidth = width - 12;
  const textHeight = doc.heightOfString(body, { width: innerWidth });
  const boxHeight = textHeight + 10;

  ensureSpace(doc, boxHeight + 6);
  const y = doc.y;

  doc.save().rect(left + 0.5, y + 0.5, width - 1, boxHeight - 1).lineWidth(0.6).strokeColor(accent).stroke().restore();
  doc.save().rect(left, y, 3, boxHeight).fill(accent).restore();

  doc.fillColor(COLORS.ink).text(body, left + 8, y + 5, { width: innerWidth });
  doc.y = y + boxHeight + 6;
}

/** Teks paragraf biasa (wrap). */
export function paragraph(doc: Doc, text: string, opts?: { size?: number; color?: string; bold?: boolean }): void {
  const left = CONTENT_LEFT(doc);
  const width = CONTENT_WIDTH(doc);
  const body = ascii(text) || '-';
  doc.font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts?.size ?? 9).fillColor(opts?.color ?? COLORS.ink);
  doc.text(body, left, doc.y, { width, align: 'left' });
  doc.y += 4;
}

/**
 * Blok tanda tangan 2 kotak: Operator Representative & Contractor Rig Manager.
 */
export function footerSignature(
  doc: Doc,
  opts: { leftName: string; leftRole: string; rightName: string; rightRole: string; signedAt?: string | null },
): void {
  const left = CONTENT_LEFT(doc);
  const width = CONTENT_WIDTH(doc);
  const gap = 16;
  const boxW = (width - gap) / 2;
  const boxH = 74;

  ensureSpace(doc, boxH + 24);

  const top = doc.y + 6;

  const drawBox = (x: number, name: string, role: string): void => {
    doc.save().strokeColor(COLORS.rule).lineWidth(0.8).rect(x, top, boxW, boxH).stroke().restore();
    doc.font('Helvetica').fontSize(6.5).fillColor(COLORS.muted);
    doc.text(ascii(role).toUpperCase(), x + 6, top + 6, { width: boxW - 12, lineBreak: false, ellipsis: true });

    // Ruang tanda tangan + garis.
    const lineY = top + boxH - 30;
    doc.save().strokeColor(COLORS.muted).lineWidth(0.5).moveTo(x + 6, lineY).lineTo(x + boxW - 6, lineY).stroke().restore();

    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink);
    doc.text(ascii(name) || '-', x + 6, lineY + 4, { width: boxW - 12, lineBreak: false, ellipsis: true });

    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted);
    doc.text(ascii(role), x + 6, lineY + 16, { width: boxW - 12, lineBreak: false, ellipsis: true });
  };

  drawBox(left, opts.leftName, opts.leftRole);
  drawBox(left + boxW + gap, opts.rightName, opts.rightRole);

  if (opts.signedAt) {
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted);
    doc.text(ascii(`Signed at: ${opts.signedAt}`), left, top + boxH + 4, { width, align: 'left', lineBreak: false });
  }

  doc.y = top + boxH + (opts.signedAt ? 20 : 10);
}
