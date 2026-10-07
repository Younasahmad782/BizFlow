import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Local file storage (development / single-server deploys).
 *
 * Layout on disk: <UPLOAD_ROOT>/<organizationId>/<uuid>.<ext>
 * The original filename NEVER touches the filesystem — the stored name is
 * always a fresh UUID plus a validated extension, which makes path
 * traversal impossible by construction. All reads resolve inside
 * UPLOAD_ROOT and are verified with path.relative().
 */

const MAX_MB = Number(process.env.UPLOAD_MAX_MB ?? 10)
export const MAX_UPLOAD_BYTES = MAX_MB * 1024 * 1024

const ALLOWED: Record<string, string[]> = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
  '.gif': ['image/gif'],
  '.pdf': ['application/pdf'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv', 'application/vnd.ms-excel'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
}

export function uploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads'))
}

export interface ValidatedUpload {
  originalName: string // sanitized for display only
  storedName: string // uuid + ext — the only name used on disk
  relativePath: string // <orgId>/<storedName> — what goes in the DB
  mimeType: string
  size: number
}

/** Validates extension + MIME pair and the original filename. Throws on reject. */
export function validateUpload(
  originalName: string,
  mimeType: string,
  size: number,
): { ext: string; safeName: string } {
  if (!originalName || size <= 0) {
    throw new UploadError('Empty file')
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw new UploadError(`File exceeds the ${MAX_MB} MB limit`)
  }
  const ext = path.extname(originalName).toLowerCase()
  const allowedMimes = ALLOWED[ext]
  if (!allowedMimes) {
    throw new UploadError(`File type "${ext || '(none)'}" is not allowed`)
  }
  if (!allowedMimes.includes(mimeType.toLowerCase())) {
    throw new UploadError('File content type does not match its extension')
  }
  // Display name: strip directories and control chars; never used on disk.
  const safeName = path
    .basename(originalName)
    // eslint-disable-next-line no-control-regex
    .replace(/[\0-\x1f\x7f]/g, '')
    .slice(0, 120)
  if (!safeName) throw new UploadError('Invalid filename')
  return { ext, safeName }
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadError'
  }
}

/** Writes a validated buffer to the org's directory. Returns DB metadata. */
export async function storeUpload(
  organizationId: string,
  originalName: string,
  mimeType: string,
  buffer: Buffer,
): Promise<ValidatedUpload> {
  const { ext, safeName } = validateUpload(originalName, mimeType, buffer.length)
  const storedName = `${randomUUID()}${ext}`
  const dir = path.join(uploadRoot(), organizationId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, storedName), buffer)
  return {
    originalName: safeName,
    storedName,
    relativePath: `${organizationId}/${storedName}`,
    mimeType: mimeType.toLowerCase(),
    size: buffer.length,
  }
}

/**
 * Resolves a stored relative path to an absolute file. Returns null when
 * the path escapes the upload root or the org directory (defense in depth).
 */
export function resolveStoredFile(relativePath: string): string | null {
  const root = uploadRoot()
  const abs = path.resolve(root, relativePath)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  // Must stay inside exactly one org directory: <orgId>/<file>
  const parts = rel.split(path.sep)
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  if (!existsSync(abs)) return null
  return abs
}

export function streamStoredFile(absolutePath: string) {
  return createReadStream(absolutePath)
}
