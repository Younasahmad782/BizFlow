import { createServer } from 'http'
import app from './app'
import { initSockets } from './lib/sockets'

const PORT = Number(process.env.PORT ?? 4000)
const server = createServer(app)
initSockets(server)
server.listen(PORT, () => {
  console.log(`BIZFLOW API running on http://localhost:${PORT}`)
})
