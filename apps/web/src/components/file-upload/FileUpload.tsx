import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { Upload, X, File, Image, FileText, Film, Music, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface FileUploadProps {
  onUpload: (files: File[]) => void | Promise<void>;
  accept?: string;
  multiple?: boolean;
  maxSize?: number; // in bytes
  maxFiles?: number;
  disabled?: boolean;
  className?: string;
  label?: string;
  description?: string;
}

interface FilePreview {
  file: File;
  preview: string | undefined;
  progress?: number;
  error: string | undefined;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const getFileIcon = (type: string) => {
  if (type.startsWith('image/')) return Image;
  if (type.startsWith('video/')) return Film;
  if (type.startsWith('audio/')) return Music;
  if (type.includes('pdf') || type.includes('document')) return FileText;
  return File;
};

export function FileUpload({
  onUpload,
  accept,
  multiple = false,
  maxSize = 10 * 1024 * 1024, // 10MB default
  maxFiles = 10,
  disabled = false,
  className,
  label = 'Upload files',
  description,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    if (file.size > maxSize) {
      return `File too large. Max size is ${formatFileSize(maxSize)}`;
    }

    if (accept) {
      const acceptedTypes = accept.split(',').map((t) => t.trim());
      const isAccepted = acceptedTypes.some((type) => {
        if (type.startsWith('.')) {
          return file.name.toLowerCase().endsWith(type.toLowerCase());
        }
        if (type.endsWith('/*')) {
          const baseType = type.slice(0, -2);
          return file.type.startsWith(baseType);
        }
        return file.type === type;
      });

      if (!isAccepted) {
        return 'File type not accepted';
      }
    }

    return null;
  };

  const processFiles = useCallback(
    (fileList: FileList | File[]) => {
      const newFiles: FilePreview[] = [];
      const filesToProcess = Array.from(fileList).slice(0, maxFiles - files.length);

      for (const file of filesToProcess) {
        const error = validateFile(file) ?? undefined;
        let preview: string | undefined;

        // Create preview for images
        if (file.type.startsWith('image/') && !error) {
          preview = URL.createObjectURL(file);
        }

        newFiles.push({ file, preview, error });
      }

      if (multiple) {
        setFiles((prev) => [...prev, ...newFiles].slice(0, maxFiles));
      } else {
        // Clean up previous previews
        files.forEach((f) => {
          if (f.preview) URL.revokeObjectURL(f.preview);
        });
        setFiles(newFiles.slice(0, 1));
      }
    },
    [files, maxFiles, maxSize, accept, multiple]
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        setIsDragging(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const droppedFiles = e.dataTransfer?.files;
      if (droppedFiles?.length) {
        processFiles(droppedFiles);
      }
    },
    [disabled, processFiles]
  );

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (selectedFiles?.length) {
        processFiles(selectedFiles);
      }
      // Reset input
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    },
    [processFiles]
  );

  const handleRemoveFile = useCallback((index: number) => {
    setFiles((prev) => {
      const newFiles = [...prev];
      const removed = newFiles.splice(index, 1)[0];
      if (removed?.preview) {
        URL.revokeObjectURL(removed.preview);
      }
      return newFiles;
    });
  }, []);

  const handleUpload = useCallback(async () => {
    const validFiles = files.filter((f) => !f.error).map((f) => f.file);
    if (validFiles.length === 0) return;

    setIsUploading(true);
    try {
      await onUpload(validFiles);
      // Clear files after successful upload
      files.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
      setFiles([]);
    } finally {
      setIsUploading(false);
    }
  }, [files, onUpload]);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const validFilesCount = files.filter((f) => !f.error).length;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Drop zone */}
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/50',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileChange}
          className="hidden"
          disabled={disabled}
        />
        <Upload className="mb-2 h-10 w-10 text-muted-foreground" />
        <p className="mb-1 text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {description ||
            `Drag and drop or click to select${multiple ? ` (max ${maxFiles} files)` : ''}`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Max size: {formatFileSize(maxSize)}
        </p>
      </div>

      {/* File previews */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((filePreview, index) => {
            const Icon = getFileIcon(filePreview.file.type);
            return (
              <div
                key={index}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3',
                  filePreview.error && 'border-destructive bg-destructive/5'
                )}
              >
                {filePreview.preview ? (
                  <img
                    src={filePreview.preview}
                    alt={filePreview.file.name}
                    className="h-10 w-10 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">{filePreview.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(filePreview.file.size)}
                  </p>
                  {filePreview.error && (
                    <p className="text-xs text-destructive">{filePreview.error}</p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveFile(index);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload button */}
      {files.length > 0 && validFilesCount > 0 && (
        <Button
          onClick={handleUpload}
          disabled={isUploading || disabled}
          className="w-full"
        >
          {isUploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Upload {validFilesCount} {validFilesCount === 1 ? 'file' : 'files'}
            </>
          )}
        </Button>
      )}
    </div>
  );
}
