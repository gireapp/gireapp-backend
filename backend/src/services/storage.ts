// ─────────────────────────────────────────────────
// GIREAPP — Object storage (Cloudflare R2)
// R2 speaks the S3 API, so the AWS SDK is used purely as a protocol client.
// ─────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Uploads are handed to the browser; 15 minutes is ample to start a PUT. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/** Reads are embedded in a lesson page, so they outlive a long reading session. */
export const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

/** Lesson media only — anything else is rejected before it reaches storage. */
const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

export function isAllowedUpload(filename: string): boolean {
  return extensionOf(filename) in ALLOWED_UPLOAD_TYPES;
}

export function contentTypeFor(filename: string): string | undefined {
  return ALLOWED_UPLOAD_TYPES[extensionOf(filename)];
}

export function allowedUploadExtensions(): string[] {
  return Object.keys(ALLOWED_UPLOAD_TYPES);
}

/**
 * Namespaced by a UUID so two tutors uploading `notes.pdf` never collide and a
 * key can't be guessed from the original filename.
 */
export function buildObjectKey(filename: string): string {
  return `lessons/${randomUUID()}${extensionOf(filename)}`;
}

/**
 * Legacy rows and seeded fixtures hold a ready-made path or absolute URL; R2
 * uploads hold a bare object key. Only the latter needs signing.
 */
export function isObjectKey(mediaUrl: string): boolean {
  return !mediaUrl.startsWith('/') && !/^https?:\/\//i.test(mediaUrl);
}

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET
  );
}

let client: S3Client | null = null;

function storageClient(): S3Client {
  if (client) return client;

  // `region: 'auto'` is R2's convention — buckets are not region-scoped.
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });
  return client;
}

export async function createUploadUrl(
  filename: string
): Promise<{ uploadUrl: string; key: string; expiresInSeconds: number }> {
  const key = buildObjectKey(filename);

  const uploadUrl = await getSignedUrl(
    storageClient(),
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET as string,
      Key: key,
      ContentType: contentTypeFor(filename),
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS }
  );

  return { uploadUrl, key, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
}

/**
 * Signed reads keep the bucket private: only an enrolled learner who fetched the
 * lesson gets a URL, and it expires. A public bucket would hand the file to
 * anyone with the link, whatever the app's own access rules say.
 */
export async function createDownloadUrl(key: string): Promise<string> {
  return getSignedUrl(
    storageClient(),
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET as string, Key: key }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS }
  );
}
