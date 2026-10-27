import { useState } from 'react';
import { api } from '@/lib/api';
import { useNotifications } from './useNotifications';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ExportColumn {
  key: string;
  header: string;
  width?: number;
}

export interface ExportOptions {
  resource: string;
  format: ExportFormat;
  columns?: ExportColumn[];
  filters?: Record<string, unknown>;
  title?: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
}

export function useExport() {
  const [isExporting, setIsExporting] = useState(false);
  const { success, error } = useNotifications();

  const exportData = async (options: ExportOptions) => {
    setIsExporting(true);
    try {
      const response = await api.post('/exports', options, {
        responseType: 'blob',
      });

      // Get filename from header or generate one
      const contentDisposition = response.headers['content-disposition'];
      let filename = `${options.resource}-export.${options.format}`;

      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) {
          filename = match[1];
        }
      }

      // Create download link
      const blob = new Blob([response.data], {
        type: response.headers['content-type'],
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      success('Export completed', {
        message: `File downloaded: ${filename}`,
        persist: true,
      });

      return true;
    } catch (err) {
      error('Export failed', {
        message: err instanceof Error ? err.message : 'Failed to export data',
      });
      return false;
    } finally {
      setIsExporting(false);
    }
  };

  const getPreview = async (resource: string, filters?: Record<string, unknown>) => {
    try {
      const response = await api.post('/exports/preview', { resource, filters });
      return response.data;
    } catch (err) {
      error('Preview failed', {
        message: 'Failed to get export preview',
      });
      return null;
    }
  };

  const getAvailableResources = async () => {
    try {
      const response = await api.get('/exports/resources');
      return response.data.resources;
    } catch (err) {
      error('Failed to fetch resources');
      return [];
    }
  };

  return {
    exportData,
    getPreview,
    getAvailableResources,
    isExporting,
  };
}
