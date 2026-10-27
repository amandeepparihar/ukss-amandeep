# File Upload Module

## Overview

The File Upload module provides a complete solution for file uploads including:
- Direct server-side upload (simple)
- Presigned URL upload (scalable, direct to S3)
- S3/MinIO storage integration
- File metadata tracking
- Permission-based access control
- Drag & drop frontend component

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    FILE UPLOAD SYSTEM                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  METHOD 1: Server-Side Upload                                   │
│  ┌────────────┐      ┌────────────┐      ┌────────────┐        │
│  │   Client   │─────►│   API      │─────►│   S3/MinIO │        │
│  │  (FormData)│      │  Server    │      │   Storage  │        │
│  └────────────┘      └────────────┘      └────────────┘        │
│                                                                  │
│  METHOD 2: Presigned URL (Recommended for large files)          │
│  ┌────────────┐      ┌────────────┐      ┌────────────┐        │
│  │   Client   │──1──►│   API      │      │   S3/MinIO │        │
│  │            │◄──2──│  (get URL) │      │            │        │
│  │            │────────────3─────────────►│            │        │
│  │            │──4──►│  (confirm) │      │            │        │
│  └────────────┘      └────────────┘      └────────────┘        │
│                                                                  │
│  Storage: files/[timestamp]-[random]-[filename]                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

```prisma
model File {
  id           String     @id @default(cuid())

  filename     String     // Stored filename (unique key)
  mimeType     String     // e.g., "application/pdf"
  size         Int        // Size in bytes

  storageKey   String     // S3 key (full path)
  storageUrl   String     // Full S3 URL

  // For images
  width        Int?
  height       Int?
  thumbnails   Json?      // { small: url, medium: url, large: url }

  // Processing status
  status       FileStatus @default(PENDING)
  processedAt  DateTime?

  // Relations
  uploadedById String
  uploadedBy   User       @relation(...)

  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  @@index([uploadedById])
  @@index([status])
  @@index([mimeType])
}

enum FileStatus {
  PENDING      // Uploaded, not processed
  PROCESSING   // Being processed
  COMPLETED    // Ready for use
  FAILED       // Processing failed
}
```

## API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/files/upload` | Direct server upload | Required |
| POST | `/api/files/presigned-upload` | Get presigned S3 URL | Required |
| POST | `/api/files/confirm-upload` | Confirm presigned upload | Required |
| GET | `/api/files` | List user's files | Required |
| GET | `/api/files/:id` | Get file metadata | Required |
| GET | `/api/files/:id/download` | Get signed download URL | Required |
| DELETE | `/api/files/:id` | Delete file | Required |

## Configuration

```typescript
// apps/api/src/config/index.ts
export const config = {
  s3: {
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    accessKey: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.S3_SECRET_KEY || 'minioadmin',
    bucket: process.env.S3_BUCKET || 'uploads',
    region: process.env.S3_REGION || 'us-east-1',
  },
  upload: {
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: [
      'image/*',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain',
    ],
  },
};
```

---

## Quick Start

### Method 1: Direct Server Upload (Simplest)

```typescript
// Frontend: Direct upload to server
async function uploadFile(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', 'documents'); // Optional subfolder

  const response = await api.post('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (progress) => {
      const percent = Math.round((progress.loaded * 100) / progress.total!);
      setProgress(percent);
    },
  });

  return response.data.data; // { id, filename, url, ... }
}
```

### Method 2: Presigned URL (Recommended for Large Files)

```typescript
// Frontend: 3-step presigned upload
async function uploadWithPresignedUrl(file: File) {
  // Step 1: Request presigned URL from your API
  const { data: presigned } = await api.post('/files/presigned-upload', {
    filename: file.name,
    mimetype: file.type,
    folder: 'documents',
  });

  // Step 2: Upload directly to S3 (bypasses your server)
  await fetch(presigned.url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });

  // Step 3: Confirm upload in your database
  const { data: fileRecord } = await api.post('/files/confirm-upload', {
    key: presigned.key,
    originalName: file.name,
    mimetype: file.type,
    size: file.size,
  });

  return fileRecord.data;
}
```

---

## Using the FileUpload Component

### Basic Usage

```tsx
import { FileUpload } from '@/components/file-upload';

function MyPage() {
  const handleUpload = async (files: File[]) => {
    for (const file of files) {
      await uploadFile(file);
    }
  };

  return (
    <FileUpload
      onUpload={handleUpload}
      accept="image/*,.pdf"
      multiple
      maxSize={5 * 1024 * 1024}  // 5MB
      maxFiles={5}
    />
  );
}
```

### Component Props

```typescript
interface FileUploadProps {
  onUpload: (files: File[]) => void | Promise<void>;
  accept?: string;              // MIME types: "image/*,.pdf"
  multiple?: boolean;           // Allow multiple files
  maxSize?: number;             // Max file size in bytes (default: 10MB)
  maxFiles?: number;            // Max number of files (default: 10)
  disabled?: boolean;           // Disable upload
  className?: string;           // Custom styling
  label?: string;               // Custom label text
  description?: string;         // Help text
}
```

### With Progress Tracking

```tsx
function UploadWithProgress() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});

  const handleUpload = async (files: File[]) => {
    setUploading(true);

    await Promise.all(
      files.map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);

        await api.post('/files/upload', formData, {
          onUploadProgress: (e) => {
            const percent = Math.round((e.loaded * 100) / e.total!);
            setProgress((p) => ({ ...p, [file.name]: percent }));
          },
        });
      })
    );

    setUploading(false);
    setProgress({});
  };

  return (
    <div>
      <FileUpload onUpload={handleUpload} multiple disabled={uploading} />

      {Object.entries(progress).map(([name, percent]) => (
        <div key={name} className="flex items-center gap-2">
          <span>{name}</span>
          <Progress value={percent} />
          <span>{percent}%</span>
        </div>
      ))}
    </div>
  );
}
```

---

## Real-World Example: User Avatar Upload

### Step 1: Create Avatar Upload Component

```tsx
// apps/web/src/components/AvatarUpload.tsx
import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Camera, Loader2 } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';

interface AvatarUploadProps {
  currentAvatar?: string;
  onAvatarChange: (url: string) => void;
  initials: string;
}

export function AvatarUpload({ currentAvatar, onAvatarChange, initials }: AvatarUploadProps) {
  const [uploading, setUploading] = useState(false);
  const { success, error } = useNotifications();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      error('Please select an image file');
      return;
    }

    // Validate file size (max 2MB for avatars)
    if (file.size > 2 * 1024 * 1024) {
      error('Image must be less than 2MB');
      return;
    }

    setUploading(true);

    try {
      // Upload the file
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'avatars');

      const { data } = await api.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      // Update user profile with new avatar URL
      await api.put('/users/me/profile', {
        avatarUrl: data.data.url,
      });

      onAvatarChange(data.data.url);
      success('Avatar updated');
    } catch (err) {
      error('Failed to upload avatar');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="relative">
      <Avatar className="h-24 w-24">
        <AvatarImage src={currentAvatar} />
        <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
      </Avatar>

      <label className="absolute bottom-0 right-0">
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
          disabled={uploading}
        />
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="rounded-full"
          disabled={uploading}
          asChild
        >
          <span>
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
          </span>
        </Button>
      </label>
    </div>
  );
}
```

### Step 2: Use in Profile Page

```tsx
// apps/web/src/pages/profile/ProfilePage.tsx
import { AvatarUpload } from '@/components/AvatarUpload';
import { useAuth } from '@/hooks/useAuth';

export function ProfilePage() {
  const { user, refetchUser } = useAuth();

  const handleAvatarChange = (url: string) => {
    refetchUser(); // Refresh user data to get new avatar
  };

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`;

  return (
    <div className="space-y-6">
      <h1>Profile Settings</h1>

      <div className="flex items-center gap-6">
        <AvatarUpload
          currentAvatar={user?.avatarUrl}
          onAvatarChange={handleAvatarChange}
          initials={initials}
        />

        <div>
          <h2 className="text-lg font-semibold">{user?.firstName} {user?.lastName}</h2>
          <p className="text-muted-foreground">{user?.email}</p>
        </div>
      </div>

      {/* Rest of profile form */}
    </div>
  );
}
```

---

## Real-World Example: Document Attachments

### Attachment Upload with Preview

```tsx
// apps/web/src/components/AttachmentUpload.tsx
import { useState } from 'react';
import { FileUpload } from '@/components/file-upload';
import { Button } from '@/components/ui/button';
import { FileText, X, Download, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/utils';

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

interface AttachmentUploadProps {
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  maxFiles?: number;
}

export function AttachmentUpload({
  attachments,
  onAttachmentsChange,
  maxFiles = 5,
}: AttachmentUploadProps) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (files: File[]) => {
    setUploading(true);

    const newAttachments: Attachment[] = [];

    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', 'attachments');

        const { data } = await api.post('/files/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        newAttachments.push({
          id: data.data.id,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
          url: data.data.url,
        });
      } catch (err) {
        console.error('Failed to upload:', file.name);
      }
    }

    onAttachmentsChange([...attachments, ...newAttachments]);
    setUploading(false);
  };

  const handleRemove = async (id: string) => {
    try {
      await api.delete(`/files/${id}`);
      onAttachmentsChange(attachments.filter((a) => a.id !== id));
    } catch (err) {
      console.error('Failed to remove attachment');
    }
  };

  const handleDownload = async (attachment: Attachment) => {
    const { data } = await api.get(`/files/${attachment.id}/download`);
    window.open(data.data.url, '_blank');
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
    if (mimeType.includes('document') || mimeType.includes('word')) return '📝';
    return '📎';
  };

  return (
    <div className="space-y-4">
      {/* Existing attachments */}
      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{getFileIcon(attachment.mimeType)}</span>
                <div>
                  <p className="font-medium">{attachment.filename}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatBytes(attachment.size)}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDownload(attachment)}
                >
                  <Download className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemove(attachment.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload new attachments */}
      {attachments.length < maxFiles && (
        <FileUpload
          onUpload={handleUpload}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/*"
          multiple
          maxFiles={maxFiles - attachments.length}
          disabled={uploading}
          label={uploading ? 'Uploading...' : 'Add attachments'}
          description={`${attachments.length}/${maxFiles} files • Max 10MB each`}
        />
      )}
    </div>
  );
}
```

### Use in a Form

```tsx
// apps/web/src/pages/tickets/CreateTicketPage.tsx
import { useState } from 'react';
import { AttachmentUpload } from '@/components/AttachmentUpload';

export function CreateTicketPage() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const handleSubmit = async (data: TicketFormData) => {
    await api.post('/tickets', {
      ...data,
      attachmentIds: attachments.map((a) => a.id), // Link files to ticket
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Title, description, etc. */}

      <div className="space-y-2">
        <Label>Attachments</Label>
        <AttachmentUpload
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          maxFiles={5}
        />
      </div>

      <Button type="submit">Create Ticket</Button>
    </form>
  );
}
```

---

## Backend Implementation Details

### S3 Service

```typescript
// apps/api/src/modules/files/s3.service.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '@/config';

const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
  forcePathStyle: true, // Required for MinIO
});

export const s3Service = {
  // Generate unique key
  generateKey(filename: string, folder?: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `${timestamp}-${random}-${sanitized}`;
    return folder ? `${folder}/${key}` : key;
  },

  // Upload file buffer
  async upload(key: string, buffer: Buffer, mimetype: string): Promise<string> {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      })
    );

    return `${config.s3.endpoint}/${config.s3.bucket}/${key}`;
  },

  // Get presigned URL for upload
  async getPresignedUploadUrl(
    key: string,
    mimetype: string,
    expiresIn = 3600
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      ContentType: mimetype,
    });

    return getSignedUrl(s3Client, command, { expiresIn });
  },

  // Get presigned URL for download
  async getPresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    });

    return getSignedUrl(s3Client, command, { expiresIn });
  },

  // Check if file exists
  async exists(key: string): Promise<boolean> {
    try {
      await s3Client.send(
        new HeadObjectCommand({
          Bucket: config.s3.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  },

  // Delete file
  async delete(key: string): Promise<void> {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
      })
    );
  },
};
```

### Files Service

```typescript
// apps/api/src/modules/files/files.service.ts
import { prisma } from '@/lib/prisma';
import { s3Service } from './s3.service';

export const filesService = {
  // Direct upload
  async upload(options: {
    buffer: Buffer;
    filename: string;
    mimetype: string;
    size: number;
    folder?: string;
    uploadedById: string;
  }) {
    const key = s3Service.generateKey(options.filename, options.folder);
    const url = await s3Service.upload(key, options.buffer, options.mimetype);

    const file = await prisma.file.create({
      data: {
        filename: options.filename,
        mimeType: options.mimetype,
        size: options.size,
        storageKey: key,
        storageUrl: url,
        uploadedById: options.uploadedById,
        status: 'COMPLETED',
      },
    });

    return { ...file, url };
  },

  // Get presigned upload URL
  async getPresignedUploadUrl(filename: string, mimetype: string, folder?: string) {
    const key = s3Service.generateKey(filename, folder);
    const url = await s3Service.getPresignedUploadUrl(key, mimetype);

    return { key, url, expiresIn: 3600 };
  },

  // Confirm presigned upload
  async confirmUpload(options: {
    key: string;
    originalName: string;
    mimetype: string;
    size: number;
    uploadedById: string;
  }) {
    // Verify file exists in S3
    const exists = await s3Service.exists(options.key);
    if (!exists) {
      throw new Error('File not found in storage');
    }

    const file = await prisma.file.create({
      data: {
        filename: options.originalName,
        mimeType: options.mimetype,
        size: options.size,
        storageKey: options.key,
        storageUrl: `${config.s3.endpoint}/${config.s3.bucket}/${options.key}`,
        uploadedById: options.uploadedById,
        status: 'COMPLETED',
      },
    });

    return file;
  },

  // Get download URL
  async getDownloadUrl(id: string, requestingUserId: string, isAdmin: boolean) {
    const file = await prisma.file.findUnique({ where: { id } });

    if (!file) throw new Error('File not found');
    if (!isAdmin && file.uploadedById !== requestingUserId) {
      throw new Error('Access denied');
    }

    const url = await s3Service.getPresignedDownloadUrl(file.storageKey);
    return { url, expiresIn: 3600 };
  },

  // Delete file
  async delete(id: string, requestingUserId: string, isAdmin: boolean) {
    const file = await prisma.file.findUnique({ where: { id } });

    if (!file) throw new Error('File not found');
    if (!isAdmin && file.uploadedById !== requestingUserId) {
      throw new Error('Access denied');
    }

    // Delete from S3
    await s3Service.delete(file.storageKey);

    // Delete from database
    await prisma.file.delete({ where: { id } });
  },
};
```

---

## Adding a New File Type

### Step 1: Update Allowed MIME Types

```typescript
// apps/api/src/modules/files/files.routes.ts
const ALLOWED_MIME_TYPES = [
  'image/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  // Add new types
  'application/zip',
  'application/x-zip-compressed',
  'video/mp4',
  'audio/mpeg',
];
```

### Step 2: Update Frontend Accept Attribute

```tsx
<FileUpload
  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.mp4,.mp3"
  // ...
/>
```

---

## Best Practices

### 1. Use Presigned URLs for Large Files
```typescript
// For files > 5MB, use presigned URLs to bypass server
const uploadStrategy = file.size > 5 * 1024 * 1024
  ? 'presigned'
  : 'direct';
```

### 2. Validate on Both Client and Server
```typescript
// Client: Quick feedback
if (file.size > maxSize) {
  error('File too large');
  return;
}

// Server: Security enforcement
if (file.mimetype && !isAllowedType(file.mimetype)) {
  return reply.status(400).send({ error: 'Invalid file type' });
}
```

### 3. Track Upload Progress
```typescript
onUploadProgress: (progressEvent) => {
  const percentCompleted = Math.round(
    (progressEvent.loaded * 100) / progressEvent.total!
  );
  setProgress(percentCompleted);
}
```

### 4. Handle Failed Uploads Gracefully
```typescript
try {
  await uploadFile(file);
  success('File uploaded');
} catch (err) {
  if (err.response?.status === 413) {
    error('File too large');
  } else if (err.response?.status === 415) {
    error('File type not allowed');
  } else {
    error('Upload failed. Please try again.');
  }
}
```

---

## Troubleshooting

### Upload Fails with 413 Error
- File exceeds size limit
- Check `maxSize` in config and frontend validation

### Upload Fails with 415 Error
- MIME type not allowed
- Add type to `ALLOWED_MIME_TYPES`

### Presigned URL Expired
- Default expiry is 1 hour
- Increase `expiresIn` or handle retry

### MinIO Connection Failed
- Check MinIO is running: `docker-compose up minio`
- Verify endpoint and credentials in config

### File Shows as PENDING
- File uploaded but processing failed
- Check processing queue/worker logs

---

## Related Files

| File | Description |
|------|-------------|
| `apps/api/src/modules/files/files.service.ts` | File upload logic |
| `apps/api/src/modules/files/files.routes.ts` | API endpoints |
| `apps/api/src/modules/files/s3.service.ts` | S3/MinIO integration |
| `apps/api/src/config/index.ts` | S3 configuration |
| `apps/web/src/components/file-upload/FileUpload.tsx` | Upload component |

---

## GitHub Issue
This documentation addresses: https://github.com/velsof/js-admin-panel/issues/30
