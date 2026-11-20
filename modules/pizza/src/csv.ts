/** RFC 4180 CSV: reading records (LF or CRLF) and writing fields, quoting only where needed. */

export class CsvSyntax extends Error {
  constructor(
    readonly row: number,
    message: string,
  ) {
    super(message);
  }
}

/** The records of `text`, each a list of fields; a final line break ends the last record. */
export function readCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const end = () => {
    record.push(field);
    records.push(record);
    record = [];
    field = "";
  };
  while (i < text.length) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        const next = text[i];
        if (next !== undefined && next !== "," && next !== "\n" && next !== "\r") {
          throw new CsvSyntax(records.length + 1, "text after a closing quote");
        }
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
      end();
      if (ch === "\r") i++;
    } else {
      field += ch;
    }
    i++;
  }
  if (quoted) throw new CsvSyntax(records.length + 1, "a quote is not closed");
  if (field !== "" || record.length > 0) end();
  return records;
}

/** One field as written: quoted when it holds a comma, a quote or a line break. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export const csvLine = (fields: string[]): string => fields.map(csvField).join(",");

/** Cents as euros with a dot and two decimals: 3800 → `38.00`. */
export function euros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
