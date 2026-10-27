import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ExportColumn {
  key: string;
  header: string;
  width?: number;
  format?: (value: unknown) => string;
}

export interface ExportOptions {
  filename: string;
  columns: ExportColumn[];
  data: Record<string, unknown>[];
  title?: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
}

export interface ExportSheet {
  name: string;
  columns: ExportColumn[];
  data: Record<string, unknown>[];
}

export interface MultiSheetExportOptions {
  filename: string;
  sheets: ExportSheet[];
}

export class ExportService {
  /**
   * Export data to CSV format
   */
  exportToCsv(options: ExportOptions): Buffer {
    const { columns, data } = options;

    // Transform data to use headers
    const transformedData = data.map((row) => {
      const transformed: Record<string, string> = {};
      for (const col of columns) {
        const value = row[col.key];
        transformed[col.header] = col.format
          ? col.format(value)
          : this.formatValue(value);
      }
      return transformed;
    });

    const csv = Papa.unparse(transformedData, {
      header: true,
      quotes: true,
    });

    return Buffer.from(csv, 'utf-8');
  }

  /**
   * Export data to Excel format
   */
  exportToExcel(options: ExportOptions): Buffer {
    const { columns, data, title } = options;

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();

    // Transform data
    const headers = columns.map((col) => col.header);
    const rows = data.map((row) =>
      columns.map((col) => {
        const value = row[col.key];
        return col.format ? col.format(value) : this.formatValue(value);
      })
    );

    // Create worksheet with headers and data
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // Set column widths
    const colWidths = columns.map((col) => ({
      wch: col.width || Math.max(col.header.length, 15),
    }));
    ws['!cols'] = colWidths;

    // Add worksheet to workbook
    const sheetName = title ? title.substring(0, 31) : 'Export';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return buffer;
  }

  /**
   * Export data to a multi-sheet Excel workbook.
   * Each sheet gets its own columns and data.
   */
  exportToExcelMultiSheet(options: MultiSheetExportOptions): Buffer {
    const wb = XLSX.utils.book_new();

    for (const sheet of options.sheets) {
      const headers = sheet.columns.map((col) => col.header);
      const rows = sheet.data.map((row) =>
        sheet.columns.map((col) => {
          const value = row[col.key];
          return col.format ? col.format(value) : this.formatValue(value);
        })
      );

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

      // Set column widths
      ws['!cols'] = sheet.columns.map((col) => ({
        wch: col.width || Math.max(col.header.length, 15),
      }));

      // Sheet name max 31 chars (Excel limit)
      const sheetName = sheet.name.substring(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  /**
   * Export data to PDF format
   */
  async exportToPdf(options: ExportOptions): Promise<Buffer> {
    const { columns, data, title, subtitle, orientation = 'portrait' } = options;

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      const doc = new PDFDocument({
        size: 'A4',
        layout: orientation,
        margin: 40,
        bufferPages: true,
      });

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Title
      if (title) {
        doc.fontSize(18).font('Helvetica-Bold').text(title, { align: 'center' });
        doc.moveDown(0.5);
      }

      // Subtitle
      if (subtitle) {
        doc.fontSize(10).font('Helvetica').text(subtitle, { align: 'center' });
        doc.moveDown(1);
      }

      // Table setup
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colCount = columns.length;
      const defaultColWidth = pageWidth / colCount;

      // Calculate column widths
      const colWidths = columns.map((col) =>
        col.width ? Math.min(col.width, defaultColWidth) : defaultColWidth
      );

      // Normalize widths to fit page
      const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
      const scale = pageWidth / totalWidth;
      const normalizedWidths = colWidths.map((w) => w * scale);

      // Draw table header
      let x = doc.page.margins.left;
      const headerY = doc.y;

      doc.fontSize(9).font('Helvetica-Bold');
      columns.forEach((col, i) => {
        doc.text(col.header, x, headerY, {
          width: normalizedWidths[i],
          align: 'left',
        });
        x += normalizedWidths[i];
      });

      // Draw header line
      doc.moveDown(0.5);
      doc
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(0.5);

      // Draw table rows
      doc.fontSize(8).font('Helvetica');

      for (const row of data) {
        // Check if we need a new page
        if (doc.y > doc.page.height - 60) {
          doc.addPage();
        }

        x = doc.page.margins.left;
        const rowY = doc.y;

        columns.forEach((col, i) => {
          const value = row[col.key];
          const text = col.format ? col.format(value) : this.formatValue(value);
          doc.text(text, x, rowY, {
            width: normalizedWidths[i],
            align: 'left',
          });
          x += normalizedWidths[i];
        });

        doc.moveDown(0.8);
      }

      // Footer with page numbers
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc
          .fontSize(8)
          .text(
            `Page ${i + 1} of ${pageCount}`,
            doc.page.margins.left,
            doc.page.height - 30,
            {
              align: 'center',
              width: pageWidth,
            }
          );
      }

      doc.end();
    });
  }

  /**
   * Export data based on format
   */
  async export(
    format: ExportFormat,
    options: ExportOptions
  ): Promise<{ buffer: Buffer; mimeType: string; extension: string }> {
    let buffer: Buffer;
    let mimeType: string;
    let extension: string;

    switch (format) {
      case 'csv':
        buffer = this.exportToCsv(options);
        mimeType = 'text/csv';
        extension = 'csv';
        break;
      case 'xlsx':
        buffer = this.exportToExcel(options);
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        extension = 'xlsx';
        break;
      case 'pdf':
        buffer = await this.exportToPdf(options);
        mimeType = 'application/pdf';
        extension = 'pdf';
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    return { buffer, mimeType, extension };
  }

  /**
   * Format a value for export
   */
  private formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }
}

export const exportService = new ExportService();
