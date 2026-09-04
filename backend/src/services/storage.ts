// ─────────────────────────────────────────────────
// GIREAPP — Object storage (S3-compatible)
// Cloudflare R2, Backblaze B2, MinIO and AWS S3 all speak the same API, so the
// provider is a matter of endpoint + credentials, never of code. Set S3_ENDPOINT
// and S3_REGION per provider; everything below is provider-agnostic.
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
 * The exact shape `buildObjectKey` mints, kept beside it so the two cannot drift.
 *
 * The browser uploads straight to storage and reports the key back, so the key
 * reaches the server as untrusted input and must be provably one this server
 * issued. A prefix test is not enough: `lessons/../billing/export.pdf` starts
 * with `lessons/`, and whatever is stored is later signed into a download URL
 * and served to every enrolled learner.
 */
const MINTED_OBJECT_KEY = new RegExp(
  `^lessons/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:${Object.keys(
    ALLOWED_UPLOAD_TYPES,
  )
    .map((extension) => extension.replace('.', '\\.'))
    .join('|')})$`,
);

export function isMintedObjectKey(key: string): boolean {
  return MINTED_OBJECT_KEY.test(key);
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
    process.env.S3_ENDPOINT &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY &&
      process.env.S3_BUCKET
  );
}

let client: S3Client | null = null;

function storageClient(): S3Client {
  if (client) return client;

  client = new S3Client({
    // R2 ignores region and expects 'auto'; B2 and S3 want a real one.
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    // Path-style keeps signed URLs on the S3_ENDPOINT origin. Virtual-hosted
    // style (the SDK default) would move them to <bucket>.<endpoint>, which the
    // frontend CSP does not name — PDFs would render as a blank iframe with no
    // error. R2 and B2 both support path-style; set S3_FORCE_PATH_STYLE=false
    // only if moving to AWS S3, which is deprecating it.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
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
      Bucket: process.env.S3_BUCKET as string,
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
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET as string, Key: key }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS }
  );
}
