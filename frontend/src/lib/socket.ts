import { io, type Socket } from 'socket.io-client'
import { getToken } from './api'

/**
 * Real-time notification socket. Connects with the session JWT; the server
 * places the client in exactly one room (its organization), so cross-org
 * events can never arrive. Same-origin: /socket.io is proxied to the API
 * in dev and by nginx in Docker.
 */

let socket: Socket | null = null
let tokenUsed: string | null = null
let handler: ((n: BizNotification) => void) | null = null

export interface BizNotification {
  id: string
  type: string
  title: string
  message: string
  isRead: boolean
  createdAt: string
}

/** (Re)connect when a session exists; re-subscribes the latest handler. */
export function connectNotifications(onNotification: (n: BizNotification) => void): void {
  const token = getToken()
  handler = onNotification
  if (!token) {
    disconnectNotifications()
    return
  }
  if (socket && tokenUsed === token) {
    socket.off('notification')
    socket.on('notification', dispatch)
    return
  }
  disconnectNotifications()
  tokenUsed = token
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] })
  socket.on('notification', dispatch)
}

function dispatch(n: BizNotification) {
  handler?.(n)
}

/** Also used on logout / org switch so the old session never lingers. */
export function disconnectNotifications(): void {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
  tokenUsed = null
}
