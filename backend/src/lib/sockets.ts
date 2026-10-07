import type { Server as HttpServer } from 'http'
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { JWT_SECRET } from '../middleware/authenticate'

let io: Server | null = null

export function orgRoom(organizationId: string): string {
  return `org:${organizationId}`
}

/**
 * Attaches Socket.IO to the HTTP server. Clients authenticate with their JWT
 * (sent as the `auth.token` handshake field) and are placed in exactly one
 * room: their own organization. They can never receive another org's events.
 */
export function initSockets(server: HttpServer): Server {
  const corsOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  const isProd = process.env.NODE_ENV === 'production'
  io = new Server(server, {
    cors: {
      origin: corsOrigins.length > 0 ? corsOrigins : !isProd,
      credentials: true,
    },
  })

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined
      if (!token) return next(new Error('Missing token'))
      const payload = jwt.verify(token, JWT_SECRET) as {
        memberId: string
        organizationId: string
        userId: string
        tv: number
      }
      const member = await prisma.organizationMember.findUnique({
        where: { id: payload.memberId },
        select: {
          isActive: true,
          organizationId: true,
          userId: true,
          user: { select: { tokenVersion: true } },
        },
      })
      if (!member || !member.isActive || member.organizationId !== payload.organizationId) {
        return next(new Error('Invalid session'))
      }
      if (member.userId !== payload.userId || member.user.tokenVersion !== payload.tv) {
        return next(new Error('Session expired'))
      }
      socket.data.organizationId = member.organizationId
      socket.data.memberId = payload.memberId
      next()
    } catch {
      next(new Error('Authentication failed'))
    }
  })

  io.on('connection', (socket) => {
    const room = orgRoom(socket.data.organizationId as string)
    socket.join(room)
    socket.emit('connected', { room: 'notifications' })
    socket.on('disconnect', () => {
      socket.leave(room)
    })
  })

  return io
}

export function getIo(): Server | null {
  return io
}
