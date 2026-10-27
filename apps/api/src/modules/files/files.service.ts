import { prisma } from '../../lib/prisma';
import { s3Service } from './s3.service';
import * as mime from 'mime-types';
import type { FileStatus } from '@prisma/client';

export interface CreateFileOptions {
  filename: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  uploadedById: string;
  folder?: string;
}

export interface FileWithUrl {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  storageUrl: string;
  status: FileStatus;
  url: string;
  createdAt: Date;
}

export class FilesService {
  /**
   * Upload a file and create a database record
   */
  async upload(options: CreateFileOptions): Promise<FileWithUrl> {
    const { filename, mimetype, size, buffer, uploadedById, folder = 'uploads' } = options;

    // Generate unique key
    const key = s3Service.generateKey(folder, filename);

    // Upload to S3
    const uploadResult = await s3Service.upload({
      key,
      body: buffer,
      contentType: mimetype,
    });

    // Create database record
    const file = await prisma.file.create({
      data: {
        filename: filename,
        mimeType: mimetype,
        size,
        storageKey: key,
        storageUrl: uploadResult.url,
        status: 'COMPLETED',
        uploadedById,
      },
    });

    return {
      ...file,
      url: uploadResult.url,
    };
  }

  /**
   * Get a file by ID with download URL
   * @param id File ID
   * @param requestingUserId User ID making the request (for ownership check)
   * @param isAdmin If true, bypasses ownership check
   */
  async getById(id: string, requestingUserId: string, isAdmin: boolean = false): Promise<FileWithUrl | null> {
    const whereClause: { id: string; uploadedById?: string } = { id };

    // Add ownership check unless admin
    if (!isAdmin) {
      whereClause.uploadedById = requestingUserId;
    }

    const file = await prisma.file.findFirst({
      where: whereClause,
    });

    if (!file) {
      return null;
    }

    const url = s3Service.getPublicUrl(file.storageKey);

    return {
      ...file,
      url,
    };
  }

  /**
   * Get a signed download URL for a file
   * @param id File ID
   * @param requestingUserId User ID making the request (for ownership check)
   * @param isAdmin If true, bypasses ownership check
   */
  async getDownloadUrl(id: string, requestingUserId: string, isAdmin: boolean = false): Promise<string | null> {
    const whereClause: { id: string; uploadedById?: string } = { id };

    // Add ownership check unless admin
    if (!isAdmin) {
      whereClause.uploadedById = requestingUserId;
    }

    const file = await prisma.file.findFirst({
      where: whereClause,
    });

    if (!file) {
      return null;
    }

    return s3Service.getSignedDownloadUrl(file.storageKey);
  }

  /**
   * Delete a file
   * @param id File ID
   * @param requestingUserId User ID making the request (for ownership check)
   * @param isAdmin If true, bypasses ownership check
   */
  async delete(id: string, requestingUserId: string, isAdmin: boolean = false): Promise<void> {
    const whereClause: { id: string; uploadedById?: string } = { id };

    // Add ownership check unless admin
    if (!isAdmin) {
      whereClause.uploadedById = requestingUserId;
    }

    const file = await prisma.file.findFirst({
      where: whereClause,
    });

    if (!file) {
      throw new Error('File not found or access denied');
    }

    // Delete from S3
    await s3Service.delete(file.storageKey);

    // Update status in database
    await prisma.file.update({
      where: { id },
      data: { status: 'DELETED' },
    });
  }

  /**
   * Get files for a user
   */
  async getByUser(
    userId: string,
    options: { page?: number; limit?: number } = {}
  ) {
    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    const [files, total] = await Promise.all([
      prisma.file.findMany({
        where: {
          uploadedById: userId,
          status: { not: 'DELETED' },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.file.count({
        where: {
          uploadedById: userId,
          status: { not: 'DELETED' },
        },
      }),
    ]);

    const filesWithUrls = files.map((file) => ({
      ...file,
      url: s3Service.getPublicUrl(file.storageKey),
    }));

    return {
      data: filesWithUrls,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get presigned upload URL for client-side upload
   */
  async getPresignedUploadUrl(
    filename: string,
    mimetype: string,
    folder: string = 'uploads'
  ) {
    const key = s3Service.generateKey(folder, filename);
    const url = await s3Service.getSignedUploadUrl(key, mimetype);

    return {
      key,
      url,
      expiresIn: 3600,
    };
  }

  /**
   * Confirm a client-side upload
   */
  async confirmUpload(
    key: string,
    originalName: string,
    mimetype: string,
    size: number,
    uploadedById: string
  ): Promise<FileWithUrl> {
    // Verify the file exists
    const exists = await s3Service.exists(key);
    if (!exists) {
      throw new Error('File not found in storage');
    }

    // Create database record
    const file = await prisma.file.create({
      data: {
        filename: originalName,
        mimeType: mimetype,
        size,
        storageKey: key,
        storageUrl: s3Service.getPublicUrl(key),
        status: 'COMPLETED',
        uploadedById,
      },
    });

    return {
      ...file,
      url: s3Service.getPublicUrl(key),
    };
  }

  /**
   * Validate file type
   */
  isAllowedType(mimetype: string, allowedTypes: string[]): boolean {
    if (allowedTypes.length === 0) {
      return true;
    }

    // Check exact match
    if (allowedTypes.includes(mimetype)) {
      return true;
    }

    // Check wildcard match (e.g., 'image/*')
    const [type] = mimetype.split('/');
    return allowedTypes.some((allowed) => {
      if (allowed.endsWith('/*')) {
        const allowedType = allowed.slice(0, -2);
        return type === allowedType;
      }
      return false;
    });
  }

  /**
   * Get mime type from filename
   */
  getMimeType(filename: string): string {
    return mime.lookup(filename) || 'application/octet-stream';
  }
}

export const filesService = new FilesService();
