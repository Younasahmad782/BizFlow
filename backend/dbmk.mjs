import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL })
await prisma.$executeRawUnsafe('SELECT 1')
await prisma.$disconnect()
