/**
 * CSV, written so a spreadsheet cannot be turned into an attack.
 *
 * These files carry tenant-controlled strings: display names, user principal names, and
 * remediation text Microsoft supplies. A field beginning with =, +, -, @ or a control
 * character is interpreted by Excel, Google Sheets and LibreOffice as a formula, which
 * makes a display name an execution path into the consultant's own machine. A tenant is
 * exactly where an attacker can set one.
 *
 * So every field is escaped for CSV and separately neutralised for formula evaluation.
 * Getting this wrong in a security report would be a poor joke.
 */

/** Characters that make a spreadsheet treat a field as a formula rather than as text. */
const FORMULA_LEADERS = /^[=+\-@\t\r]/;

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value);

  // Prefix, rather than strip. A legitimate value like "-5" or an Exchange rule named
  // "=SUM report" must survive intact and readable; the apostrophe is what tells the
  // spreadsheet to treat it as text, and it is not shown as part of the value.
  if (FORMULA_LEADERS.test(text)) text = `'${text}`;

  // Newlines inside a quoted field are legal CSV, but they break naive parsers and make
  // a row unreadable in a diff. Remediation text is full of them.
  text = text.replace(/\r\n|\r|\n/g, ' ').replace(/\s{2,}/g, ' ').trim();

  if (/[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeCsvField(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => escapeCsvField(c.value(r))).join(','));
  // A trailing newline: POSIX tools and Excel both prefer one, and its absence is the
  // kind of thing that silently eats the last row in a pipeline.
  return [head, ...body].join('\n') + '\n';
}
