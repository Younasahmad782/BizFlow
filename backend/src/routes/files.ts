import { Router } from 'express'
import multer, { MulterError } from 'multer'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { pagination } from '../schemas/common'
import {
  MAX_UPLOAD_BYTES,
  resolveStoredFile,
  storeUpload,
  streamStoredFile,
  UploadError,
} from '../services/storage'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

// In-memory buffering: nothing touches disk until validation passes.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
})

const ATTACH_PERMS = ['products.create', 'orders.create', 'invoices.create'] as const

// GET /api/files — list file metadata (never exposes storage internals)
router.get('/', requirePermission('products.read', 'orders.read', 'invoices.read'), async (req, res, next) => {
  try {
    const { take, skip } = pagination.parse(req.query)
    const where: Record<string, unknown> = { organizationId: req.member!.organizationId }
    if (req.query.entity) where.entity = String(req.query.entity)
    if (req.query.entityId) where.entityId = String(req.query.entityId)
    const files = await prisma.file.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, user: { select: { name: true } } } } },
    })
    res.json(
      files.map((f) => ({
        id: f.id,
        filename: f.filename,
        mimeType: f.mimeType,
        size: f.size,
        entity: f.entity,
        entityId: f.entityId,
        uploadedBy: f.uploadedBy ? { id: f.uploadedBy.id, name: f.uploadedBy.user.name } : null,
        createdAt: f.createdAt,
      })),
    )
  } catch (e) {
    next(e)
  }
})

// POST /api/files — real binary upload (multipart field "file").
// Validates MIME + extension + size, generates a safe UUID filename, stores
// under <uploads>/<orgId>/, and records metadata in PostgreSQL.
router.post(
  '/',
  requirePermission(...ATTACH_PERMS),
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError(400, 'BAD_REQUEST', 'File exceeds the size limit'))
        }
        return next(new AppError(400, 'BAD_REQUEST', 'Invalid upload'))
      }
      next(err)
    })
  },
  async (req, res, next) => {
    try {
      const file = (req as unknown as { file?: Express.Multer.File }).file
      if (!file) throw new AppError(400, 'BAD_REQUEST', 'No file attached (field "file")')

      const meta = z
        .object({
          entity: z.enum(['product', 'order', 'invoice', 'customer', 'supplier']).optional(),
          entityId: z.string().uuid().optional(),
        })
        .parse(req.body)
      const organizationId = req.member!.organizationId

      // Referenced records must belong to the caller's organization.
      if (meta.entity && meta.entityId) {
        const model = {
          product: 'product',
          order: 'order',
          invoice: 'invoice',
          customer: 'customer',
          supplier: 'supplier',
        }[meta.entity]
        const found = await (
          prisma as unknown as Record<string, { findFirst: (a: unknown) => Promise<unknown> }>
        )[model].findFirst({ where: { id: meta.entityId, organizationId } })
        if (!found) throw new AppError(404, 'NOT_FOUND', 'Referenced record not found')
      }

      let stored
      try {
        stored = await storeUpload(organizationId, file.originalname, file.mimetype, file.buffer)
      } catch (e) {
        if (e instanceof UploadError) throw new AppError(400, 'BAD_REQUEST', e.message)
        throw e
      }

      const record = await prisma.file.create({
        data: {
          organizationId,
          uploadedById: req.member!.memberId,
          filename: stored.originalName,
          mimeType: stored.mimeType,
          size: stored.size,
          path: stored.relativePath,
          entity: meta.entity,
          entityId: meta.entityId,
        },
      })
      res.status(201).json({
        id: record.id,
        filename: record.filename,
        mimeType: record.mimeType,
        size: record.size,
        entity: record.entity,
        entityId: record.entityId,
        createdAt: record.createdAt,
      })
    } catch (e) {
      next(e)
    }
  },
)

// GET /api/files/:id/download — tenant-scoped, authorized streaming download.
// The file is resolved inside the upload root; cross-org IDs return 404.
router.get(
  '/:id/download',
  requirePermission('products.read', 'orders.read', 'invoices.read'),
  async (req, res, next) => {
    try {
      const organizationId = req.member!.organizationId
      const file = await prisma.file.findFirst({
        where: { id: String(req.params.id), organizationId },
      })
      if (!file) throw new AppError(404, 'NOT_FOUND', 'File not found')

      const abs = resolveStoredFile(file.path)
      if (!abs) throw new AppError(404, 'NOT_FOUND', 'File not found')

      res.setHeader('Content-Type', file.mimeType ?? 'application/octet-stream')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${file.filename.replace(/["\r\n]/g, '')}"`,
      )
      if (file.size) res.setHeader('Content-Length', String(file.size))
      streamStoredFile(abs).pipe(res)
    } catch (e) {
      next(e)
    }
  },
)

export default router
