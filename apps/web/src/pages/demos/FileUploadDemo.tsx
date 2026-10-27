import { useState } from 'react';
import { Upload, File, Image, Trash2, Download, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useNotifications } from '@/hooks/useNotifications';

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  url?: string;
}

export function FileUploadDemo() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const { success } = useNotifications();

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const simulateUpload = (file: File) => {
    const uploadedFile: UploadedFile = {
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      size: file.size,
      type: file.type,
      progress: 0,
      status: 'uploading',
    };

    setFiles((prev) => [...prev, uploadedFile]);

    // Simulate upload progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 20;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setFiles((prev) =>
          prev.map((f) =>
            f.id === uploadedFile.id
              ? { ...f, progress: 100, status: 'completed', url: URL.createObjectURL(file) }
              : f
          )
        );
        success('Upload Complete', { message: `${file.name} uploaded successfully` });
      } else {
        setFiles((prev) =>
          prev.map((f) => (f.id === uploadedFile.id ? { ...f, progress } : f))
        );
      }
    }, 200);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles) {
      Array.from(selectedFiles).forEach(simulateUpload);
    }
    e.target.value = ''; // Reset input
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = e.dataTransfer.files;
    Array.from(droppedFiles).forEach(simulateUpload);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">File Upload</h1>
        <p className="text-muted-foreground">
          File upload components with S3/MinIO integration and progress tracking.
        </p>
      </div>

      <Tabs defaultValue="demo" className="space-y-4">
        <TabsList>
          <TabsTrigger value="demo">Demo</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="demo" className="space-y-4">
          {/* Drag & Drop Zone */}
          <Card>
            <CardHeader>
              <CardTitle>Drag & Drop Upload</CardTitle>
              <CardDescription>
                Drag files here or click to select (simulated upload)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input')?.click()}
              >
                <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-medium">Drop files here</p>
                <p className="text-sm text-muted-foreground mt-1">
                  or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Supports: Images, Documents, PDFs (max 10MB)
                </p>
                <Input
                  id="file-input"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
            </CardContent>
          </Card>

          {/* Upload Progress */}
          {files.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Uploaded Files</CardTitle>
                <CardDescription>{files.length} file(s)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center gap-4 p-3 border rounded-lg"
                    >
                      <div className="flex-shrink-0">
                        {file.type.startsWith('image/') ? (
                          <Image className="h-8 w-8 text-blue-500" />
                        ) : (
                          <File className="h-8 w-8 text-gray-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(file.size)}
                        </p>
                        {file.status === 'uploading' && (
                          <Progress value={file.progress} className="h-1 mt-2" />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {file.status === 'completed' && file.url && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => window.open(file.url, '_blank')}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon">
                              <Download className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeFile(file.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Button Upload */}
          <Card>
            <CardHeader>
              <CardTitle>Button Upload</CardTitle>
              <CardDescription>Simple button-based file selection</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <div>
                  <Label htmlFor="single-file">Single File</Label>
                  <Input
                    id="single-file"
                    type="file"
                    className="mt-1"
                    onChange={handleFileSelect}
                  />
                </div>
                <div>
                  <Label htmlFor="multi-file">Multiple Files</Label>
                  <Input
                    id="multi-file"
                    type="file"
                    multiple
                    className="mt-1"
                    onChange={handleFileSelect}
                  />
                </div>
                <div>
                  <Label htmlFor="image-only">Images Only</Label>
                  <Input
                    id="image-only"
                    type="file"
                    accept="image/*"
                    className="mt-1"
                    onChange={handleFileSelect}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="features" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">S3/MinIO Integration</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Files are stored in S3-compatible storage (MinIO in dev). Supports presigned URLs.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Drag & Drop</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Intuitive drag and drop interface with visual feedback on hover.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Progress Tracking</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Real-time upload progress with percentage and visual progress bar.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">File Type Validation</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Validate allowed file types with accept attribute or custom validation.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Size Limits</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Configurable max file size (default 10MB). Shows error for oversized files.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Multiple Files</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Upload multiple files at once with individual progress tracking.
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Backend API Endpoints</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// Upload file
POST /api/files/upload
Content-Type: multipart/form-data
Body: { file: File, folder?: string }
Response: { id, filename, url, size, mimetype }

// Get presigned upload URL (client-side upload)
POST /api/files/presigned
Body: { filename, mimetype, folder }
Response: { key, url, expiresIn }

// Confirm upload (after client-side upload)
POST /api/files/confirm
Body: { key, originalName, mimetype, size }

// Get file by ID
GET /api/files/:id
Response: { id, filename, url, size, mimetype, createdAt }

// Delete file
DELETE /api/files/:id`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>S3 Service Usage</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// apps/api/src/modules/files/s3.service.ts

import { s3Service } from './s3.service';

// Upload file
const result = await s3Service.upload({
  key: 'uploads/image.jpg',
  body: buffer,
  contentType: 'image/jpeg',
});
// { url, key, bucket }

// Get signed download URL
const url = await s3Service.getSignedDownloadUrl(key);

// Get signed upload URL (for client-side upload)
const url = await s3Service.getSignedUploadUrl(key, mimetype);

// Check if file exists
const exists = await s3Service.exists(key);

// Delete file
await s3Service.delete(key);

// Get public URL
const publicUrl = s3Service.getPublicUrl(key);`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Frontend Upload Hook</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// Example upload implementation
import { api } from '@/lib/api';

async function uploadFile(file: File, folder = 'uploads') {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);

  const response = await api.post('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (progressEvent) => {
      const progress = Math.round(
        (progressEvent.loaded * 100) / progressEvent.total!
      );
      setProgress(progress);
    },
  });

  return response.data;
}

// Presigned upload (direct to S3)
async function uploadDirect(file: File) {
  // 1. Get presigned URL
  const { url, key } = await api.post('/files/presigned', {
    filename: file.name,
    mimetype: file.type,
  });

  // 2. Upload directly to S3
  await fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });

  // 3. Confirm upload
  const result = await api.post('/files/confirm', {
    key,
    originalName: file.name,
    mimetype: file.type,
    size: file.size,
  });

  return result.data;
}`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
