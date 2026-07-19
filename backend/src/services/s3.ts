// ─────────────────────────────────────────────────
// GIREAPP — S3 Presigned URL Generation
// For PDF/video uploads (M3: BE-ADMIN-003)
// ─────────────────────────────────────────────────

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let s3Client: S3Client | null = null;

function getS3(): S3Client {
  if (s3Client) return s3Client;

  const region = process.env.AWS_REGION || 'auto'; // 'auto' is used by Cloudflare R2
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const endpoint = process.env.S3_ENDPOINT;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('[GIREAPP] S3 credentials not configured');
  }

  s3Client = new S3Client({
    region,
    endpoint, // If provided, it overrides AWS and connects to Cloudflare R2, Backblaze, etc.
    credentials: { accessKeyId, secretAccessKey },
  });

  return s3Client;
}

const BUCKET = process.env.AWS_S3_BUCKET ?? 'gireapp-media';

/** Allowed file types for upload (per M3: BE-ADMIN-003) */
const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

interface PresignedUploadResult {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

/**
 * Generate a presigned PUT URL for direct client-side upload
 * URL valid for 15 minutes (per acceptance criteria)
 */
export async function generateUploadUrl(
  contentType: string,
  fileName: string,
  folder: string = 'lessons'
): Promise<PresignedUploadResult> {
  if (!ALLOWED_TYPES[contentType]) {
    throw new Error(`Unsupported file type: ${contentType}. Allowed: ${Object.values(ALLOWED_TYPES).join(', ')}`);
  }

  const client = getS3();
  const ext = ALLOWED_TYPES[contentType];
  const timestamp = Date.now();
  const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const key = `${folder}/${timestamp}_${safeFileName}${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 }); // 15 min

  const publicUrlBase = process.env.S3_PUBLIC_URL 
    ? process.env.S3_PUBLIC_URL 
    : `https://${BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`;

  return {
    uploadUrl,
    key,
    publicUrl: `${publicUrlBase}/${key}`,
  };
}

/** Generate a presigned GET URL for private content access */
export async function generateDownloadUrl(key: string): Promise<string> {
  const client = getS3();

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn: 3600 }); // 1 hour
}

/** Validate file size on server side */
export function validateFileSize(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_FILE_SIZE;
}

/** Check if content type is allowed */
export function isAllowedType(contentType: string): boolean {
  return contentType in ALLOWED_TYPES;
}
