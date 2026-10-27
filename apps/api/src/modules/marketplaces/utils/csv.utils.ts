/**
 * CSV Utilities
 *
 * CSV generation utilities for marketplace product feeds.
 * Used by: Fruugo, OnBuy
 */

import { createWriteStream } from 'fs';
import { Writable } from 'stream';
import { fileUtils } from './file.utils';

/**
 * Options for CSV generation.
 */
export interface CsvOptions {
  /** Field delimiter (default: ',') */
  delimiter?: string;
  /** Quote character (default: '"') */
  quote?: string;
  /** Line ending (default: '\n') */
  lineEnding?: string;
  /** Include BOM for Excel compatibility */
  includeBom?: boolean;
}

/**
 * Options for writing CSV files.
 */
export interface CsvWriteOptions extends CsvOptions {
  /** Archive existing file before overwriting */
  archive?: boolean;
}

/**
 * Default CSV options.
 */
const DEFAULT_OPTIONS: CsvOptions = {
  delimiter: ',',
  quote: '"',
  lineEnding: '\n',
  includeBom: false,
};

/**
 * CSV utilities object.
 */
export const csvUtils = {
  /**
   * Escape a value for CSV.
   * Handles quotes, delimiters, and newlines.
   *
   * @param value - Value to escape
   * @param options - CSV options
   * @returns Escaped value safe for CSV
   *
   * @example
   * csvUtils.escapeValue('Hello, World'); // '"Hello, World"'
   * csvUtils.escapeValue('Say "Hi"');     // '"Say ""Hi"""'
   */
  escapeValue(value: unknown, options?: CsvOptions): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    if (value === null || value === undefined) {
      return '';
    }

    const str = String(value);

    // Check if quoting is needed
    const needsQuoting =
      str.includes(opts.delimiter!) ||
      str.includes(opts.quote!) ||
      str.includes('\n') ||
      str.includes('\r');

    if (!needsQuoting) {
      return str;
    }

    // Escape quotes by doubling them
    const escaped = str.replace(new RegExp(opts.quote!, 'g'), opts.quote! + opts.quote!);
    return `${opts.quote}${escaped}${opts.quote}`;
  },

  /**
   * Build a CSV row from values.
   *
   * @param values - Array of values
   * @param options - CSV options
   * @returns CSV row string
   *
   * @example
   * csvUtils.buildRow(['A', 'B', 'C']); // 'A,B,C'
   * csvUtils.buildRow(['A', 'B,C', 'D']); // 'A,"B,C",D'
   */
  buildRow(values: unknown[], options?: CsvOptions): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    return values.map((v) => this.escapeValue(v, opts)).join(opts.delimiter);
  },

  /**
   * Build a complete CSV string from headers and rows.
   *
   * @param headers - Column headers
   * @param rows - Data rows (2D array)
   * @param options - CSV options
   * @returns Complete CSV string
   *
   * @example
   * const csv = csvUtils.build(
   *   ['Name', 'Price'],
   *   [['Widget', 9.99], ['Gadget', 19.99]]
   * );
   */
  build(headers: string[], rows: unknown[][], options?: CsvOptions): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const lines: string[] = [];

    // Add BOM if requested (for Excel compatibility)
    let prefix = '';
    if (opts.includeBom) {
      prefix = '\uFEFF';
    }

    // Add header row
    lines.push(this.buildRow(headers, opts));

    // Add data rows
    for (const row of rows) {
      lines.push(this.buildRow(row, opts));
    }

    return prefix + lines.join(opts.lineEnding);
  },

  /**
   * Build CSV from array of objects.
   *
   * @param data - Array of objects
   * @param columns - Column definitions (key and optional header)
   * @param options - CSV options
   * @returns Complete CSV string
   *
   * @example
   * const csv = csvUtils.buildFromObjects(
   *   [{ name: 'Widget', price: 9.99 }],
   *   [
   *     { key: 'name', header: 'Product Name' },
   *     { key: 'price', header: 'Price (USD)' }
   *   ]
   * );
   */
  buildFromObjects<T extends Record<string, unknown>>(
    data: T[],
    columns: Array<{ key: keyof T; header?: string }>,
    options?: CsvOptions
  ): string {
    const headers = columns.map((col) => col.header || String(col.key));
    const rows = data.map((item) => columns.map((col) => item[col.key]));
    return this.build(headers, rows, options);
  },

  /**
   * Write CSV to file using temp file pattern.
   * Writes to temp location first, then moves atomically.
   *
   * @param filePath - Final file path
   * @param headers - Column headers
   * @param rows - Data rows
   * @param options - Write options
   *
   * @example
   * await csvUtils.writeFile(
   *   '/feeds/product_feed.csv',
   *   ['SKU', 'Name', 'Price'],
   *   [['ABC', 'Widget', 9.99]],
   *   { archive: true }
   * );
   */
  async writeFile(
    filePath: string,
    headers: string[],
    rows: unknown[][],
    options?: CsvWriteOptions
  ): Promise<void> {
    const content = this.build(headers, rows, options);
    await fileUtils.writeWithTemp(filePath, content, options?.archive);
  },

  /**
   * Write CSV to file with streaming for large datasets.
   * Uses streaming to avoid memory issues with large files.
   *
   * @param filePath - Final file path
   * @param headers - Column headers
   * @param rowGenerator - Generator function that yields rows
   * @param options - Write options
   *
   * @example
   * await csvUtils.writeFileStreaming(
   *   '/feeds/large_feed.csv',
   *   ['SKU', 'Name'],
   *   async function* () {
   *     for (const item of items) {
   *       yield [item.sku, item.name];
   *     }
   *   },
   *   { archive: true }
   * );
   */
  async writeFileStreaming(
    filePath: string,
    headers: string[],
    rowGenerator: () => AsyncGenerator<unknown[], void, unknown>,
    options?: CsvWriteOptions
  ): Promise<number> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Prepare paths
    const tempPath = await fileUtils.getTempPath(filePath);
    await fileUtils.ensureDir(tempPath);

    // Create write stream
    const stream = createWriteStream(tempPath, { encoding: 'utf-8' });

    return new Promise((resolve, reject) => {
      let rowCount = 0;

      const writable = new Writable({
        write(chunk, encoding, callback) {
          stream.write(chunk, callback);
        },
      });

      const writeAsync = async () => {
        try {
          // Write BOM if requested
          if (opts.includeBom) {
            stream.write('\uFEFF');
          }

          // Write header
          stream.write(this.buildRow(headers, opts) + opts.lineEnding);

          // Write data rows
          for await (const row of rowGenerator()) {
            stream.write(this.buildRow(row, opts) + opts.lineEnding);
            rowCount++;
          }

          stream.end();
        } catch (error) {
          stream.destroy(error as Error);
          reject(error);
        }
      };

      stream.on('finish', async () => {
        try {
          // Archive existing file if requested
          if (options?.archive) {
            await fileUtils.archiveFile(filePath).catch(() => {
              /* File may not exist */
            });
          }

          // Move temp to final
          await fileUtils.moveFile(tempPath, filePath);
          resolve(rowCount);
        } catch (error) {
          reject(error);
        }
      });

      stream.on('error', reject);

      writeAsync();
    });
  },

  /**
   * Parse CSV string to array of arrays.
   * Simple parser for basic CSV files.
   *
   * @param csv - CSV string
   * @param options - CSV options
   * @returns Array of rows, each row is array of values
   */
  parse(csv: string, options?: CsvOptions): string[][] {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const rows: string[][] = [];
    const lines = csv.split(/\r?\n/);

    for (const line of lines) {
      if (!line.trim()) continue;
      rows.push(this.parseLine(line, opts));
    }

    return rows;
  },

  /**
   * Parse a single CSV line.
   */
  parseLine(line: string, options: CsvOptions): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    const quote = options.quote!;
    const delimiter = options.delimiter!;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (inQuotes) {
        if (char === quote) {
          if (nextChar === quote) {
            // Escaped quote
            current += quote;
            i++; // Skip next quote
          } else {
            // End of quoted field
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else {
        if (char === quote) {
          inQuotes = true;
        } else if (char === delimiter) {
          values.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }

    // Push last value
    values.push(current);

    return values;
  },

  /**
   * Parse CSV to array of objects using first row as headers.
   *
   * @param csv - CSV string
   * @param options - CSV options
   * @returns Array of objects
   */
  parseToObjects<T extends Record<string, string>>(
    csv: string,
    options?: CsvOptions
  ): T[] {
    const rows = this.parse(csv, options);
    if (rows.length < 2) return [];

    const headers = rows[0];
    const data: T[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj: Record<string, string> = {};

      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = row[j] || '';
      }

      data.push(obj as T);
    }

    return data;
  },
};

export default csvUtils;
