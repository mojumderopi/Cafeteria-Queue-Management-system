// Image upload helper. Two modes:
//
//   1. S3-compatible (preferred for production).
//      Set MENU_UPLOAD_S3_BUCKET, MENU_UPLOAD_S3_REGION, and
//      MENU_UPLOAD_S3_ACCESS_KEY_ID + MENU_UPLOAD_S3_SECRET_ACCESS_KEY.
//      Optionally MENU_UPLOAD_S3_ENDPOINT for MinIO / Cloudflare R2.
//
//   2. Local disk (dev / small deployments).
//      Set MENU_UPLOAD_DIR (default `<cwd>/public/uploads/menu`).
//      Files are served from /uploads/menu/<filename> by Next.js' static
//      handling. NOT recommended for multi-instance or ephemeral deployments.
//
// The active backend is chosen once per process. Callers use
// `storeImage(file)` to persist a validated image and get back a public URL
// and a storage key. If the image exceeds the size limit or has an
// unsupported content type, the function throws an `UploadError` that the
// route handler turns into a 4xx response.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT_FOR: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export class UploadError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

interface StoreResult {
  url: string;
  key: string;
}

interface Backend {
  store(buf: Buffer, type: string, key: string): Promise<StoreResult>;
  publicUrl(key: string): string;
}

class LocalBackend implements Backend {
  constructor(private dir: string, private publicPrefix: string) {}
  async store(buf: Buffer, type: string, key: string): Promise<StoreResult> {
    const ext = EXT_FOR[type] ?? ".bin";
    const filename = `${key}${ext}`;
    const fullPath = join(this.dir, filename);
    await mkdir(this.dir, { recursive: true });
    await writeFile(fullPath, buf);
    return { url: this.publicUrl(filename), key: filename };
  }
  publicUrl(key: string): string {
    return `${this.publicPrefix}/${key}`;
  }
}

class S3Backend implements Backend {
  constructor(
    private bucket: string,
    private region: string,
    private accessKeyId: string,
    private secretAccessKey: string,
    private endpoint: string | null,
    private publicBase: string,
  ) {}
  async store(buf: Buffer, type: string, key: string): Promise<StoreResult> {
    const ext = EXT_FOR[type] ?? ".bin";
    const objectKey = `${key}${ext}`;
    // For an AWS S3 request the URL is virtual-host style
    // (https://<bucket>.s3.<region>.amazonaws.com/<key>) and the canonical
    // URI is "/<key>". For a custom endpoint the URL is path-style
    // (https://<endpoint>/<bucket>/<key>) and the canonical URI is
    // "/<bucket>/<key>". Either way the Host header on the request must
    // match the host portion of the URL, and that is also what the SigV4
    // canonical `host` header must be.
    const requestHost = this.endpoint
      ? new URL(this.endpoint.replace(/\/$/, "")).host
      : `${this.bucket}.s3.${this.region}.amazonaws.com`;
    const canonicalUri = this.endpoint
      ? `/${this.bucket}/${encodeURI(objectKey).replace(/\+/g, "%2B")}`
      : "/" + encodeURI(objectKey).replace(/\+/g, "%2B");
    const url = this.endpoint
      ? `https://${requestHost}/${this.bucket}/${objectKey}`
      : `https://${this.bucket}.s3.${this.region}.amazonaws.com/${objectKey}`;
    const body = Readable.from(buf) as unknown as ReadableStream;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "content-type": type,
        "content-length": String(buf.length),
        "x-amz-acl": "public-read",
        "x-amz-content-sha256": createHash("sha256").update(buf).digest("hex"),
        "x-amz-date": s3Date(),
        authorization: await s3SigV4(
          "PUT",
          this.bucket,
          this.region,
          objectKey,
          type,
          buf,
          this.accessKeyId,
          this.secretAccessKey,
          { host: requestHost, canonicalUri },
        ),
      },
      body: body as unknown as BodyInit,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new UploadError("upload_failed", `S3 upload failed: ${res.status} ${text}`);
    }
    return { url: this.publicUrl(objectKey), key: objectKey };
  }
  publicUrl(key: string): string {
    if (this.endpoint) {
      return `${this.endpoint.replace(/\/$/, "")}/${this.bucket}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}

function s3Date() {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

// Minimal SigV4 PUT signing for the common case (no SSE, single-part).
// Sufficient for the image-upload use case; intentionally narrow.
//
// `host` is the value of the request's Host header (so custom S3-compatible
// endpoints like MinIO/R2 sign correctly). Defaults to the AWS virtual-host
// form so the common case is unchanged.
//
// `canonicalUri` is the path component to sign (without scheme/host). It
// defaults to "/<key>" (virtual-host style) for AWS S3. For custom
// endpoints that use path-style addressing (e.g. MinIO with
// `endpoint/bucket/key`), the caller should pass "/<bucket>/<key>".
async function s3SigV4(
  method: string,
  bucket: string,
  region: string,
  key: string,
  contentType: string,
  body: Buffer,
  accessKey: string,
  secretKey: string,
  opts: { host?: string; canonicalUri?: string } = {},
): Promise<string> {
  const now = new Date();
  const amzDate =
    now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const host = opts.host ?? `${bucket}.s3.${region}.amazonaws.com`;
  const canonicalUri = opts.canonicalUri ?? ("/" + encodeURI(key).replace(/\+/g, "%2B"));
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const canonicalHeaders = `content-length:${body.length}\ncontent-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-length;content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const kDate = createHmac("sha256", `AWS4${secretKey}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update("s3").digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

let cached: Backend | null = null;
function backend(): Backend {
  if (cached) return cached;
  const bucket = process.env.MENU_UPLOAD_S3_BUCKET;
  const region = process.env.MENU_UPLOAD_S3_REGION;
  const accessKey = process.env.MENU_UPLOAD_S3_ACCESS_KEY_ID;
  const secretKey = process.env.MENU_UPLOAD_S3_SECRET_ACCESS_KEY;
  if (bucket && region && accessKey && secretKey) {
    const endpoint = process.env.MENU_UPLOAD_S3_ENDPOINT ?? null;
    const publicBase = process.env.MENU_UPLOAD_S3_PUBLIC_BASE ??
      (endpoint ? `${endpoint.replace(/\/$/, "")}/${bucket}` : `https://${bucket}.s3.${region}.amazonaws.com`);
    cached = new S3Backend(bucket, region, accessKey, secretKey, endpoint, publicBase);
    return cached;
  }
  // In production we refuse to fall back to the local filesystem because it
  // is ephemeral on many platforms. Surface a clear error so the operator
  // knows to configure S3.
  if (process.env.NODE_ENV === "production") {
    throw new UploadError(
      "storage_not_configured",
      "Image uploads require S3 credentials in production (MENU_UPLOAD_S3_*)",
      503,
    );
  }
  const dir = resolve(process.env.MENU_UPLOAD_DIR ?? "public/uploads/menu");
  cached = new LocalBackend(dir, "/uploads/menu");
  return cached;
}

export async function storeImage(file: File): Promise<StoreResult> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new UploadError(
      "unsupported_type",
      "Only JPEG, PNG, and WebP images are allowed",
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new UploadError(
      "too_large",
      `Image is too large (max ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} MB)`,
    );
  }
  // Read into memory; we already capped at 5 MB so this is bounded.
  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);
  const key = randomBytes(16).toString("hex");
  return backend().store(buf, file.type, key);
}

// Exposed for tests; in dev mode this is a no-op when the dir already
// exists. Not part of the public contract.
export async function _localDirSize(): Promise<number> {
  const dir = resolve(process.env.MENU_UPLOAD_DIR ?? "public/uploads/menu");
  try {
    const s = await stat(dir);
    return s.isDirectory() ? 1 : 0;
  } catch {
    return 0;
  }
}

// Read a file from local disk (used only by test code to verify uploads).
export function _openLocal(key: string): NodeJS.ReadableStream {
  const dir = resolve(process.env.MENU_UPLOAD_DIR ?? "public/uploads/menu");
  return createReadStream(join(dir, key));
}

// Avoid unused-import warning from extname if tree-shaken.
void extname;
