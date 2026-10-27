import { api } from '@/lib/api';

/**
 * Download a blob export from the given API URL.
 * Creates a temporary link, triggers download, and cleans up.
 */
export async function downloadBlobExport(url: string, fallbackFilename: string): Promise<void> {
  const response = await api.get(url, { responseType: 'blob' });

  const contentDisposition = response.headers['content-disposition'];
  const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] ?? fallbackFilename;

  const blob = new Blob([response.data], { type: response.headers['content-type'] });
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(objectUrl);
}
