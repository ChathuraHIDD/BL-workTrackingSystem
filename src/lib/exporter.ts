import { formatDateTimeISO } from './dates';
import type { Row } from './reports';

export interface Sheet {
  name: string;
  rows: Row[];
  /** Column headings to use when `rows` is empty, so an empty export is still readable. */
  headers?: string[];
}

export type ExportFormat = 'xlsx' | 'csv';

function safeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_');
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  // neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(sheet: Sheet): string {
  const headers = sheet.rows.length ? Object.keys(sheet.rows[0]) : (sheet.headers ?? []);
  const lines = [headers.map(csvCell).join(',')];
  for (const r of sheet.rows) lines.push(headers.map((h) => csvCell(r[h])).join(','));
  return lines.join('\r\n');
}

/**
 * Export one or more sheets. XLSX includes every sheet plus a "Report Info"
 * sheet describing the filters; CSV contains the first (primary) sheet.
 */
export async function exportReport(opts: {
  baseName: string;
  format: ExportFormat;
  sheets: Sheet[];
  info: [string, string][];
}): Promise<void> {
  const stamp = formatDateTimeISO(new Date().toISOString()).replace(/[: ]/g, '-');
  const file = safeFileName(`${opts.baseName}_${stamp}`);

  if (opts.format === 'csv') {
    const csv = '﻿' + toCsv(opts.sheets[0]); // BOM so Excel reads UTF-8 correctly
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${file}.csv`);
    return;
  }

  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const sheet of opts.sheets) {
    const headers = sheet.rows.length ? Object.keys(sheet.rows[0]) : (sheet.headers ?? []);
    const ws = sheet.rows.length
      ? XLSX.utils.json_to_sheet(sheet.rows, { header: headers })
      : XLSX.utils.aoa_to_sheet([headers, ['No records match the selected filters.']]);
    ws['!cols'] = headers.map((h) => {
      const longest = Math.max(h.length, ...sheet.rows.slice(0, 500).map((r) => String(r[h] ?? '').length));
      return { wch: Math.min(60, Math.max(10, longest + 2)) };
    });
    if (headers.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, sheet.rows.length), c: headers.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  const infoRows = [
    ['Battery Lab Energy — Work Tracking System'],
    [],
    ...opts.info,
    ['Generated at (Asia/Colombo)', formatDateTimeISO(new Date().toISOString())],
    ['Timezone', 'Asia/Colombo (UTC+05:30). Date ranges are inclusive; weeks run Monday–Sunday.'],
  ];
  const infoWs = XLSX.utils.aoa_to_sheet(infoRows);
  infoWs['!cols'] = [{ wch: 30 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, infoWs, 'Report Info');
  XLSX.writeFile(wb, `${file}.xlsx`, { compression: true });
}
