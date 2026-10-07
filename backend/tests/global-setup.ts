import { execSync } from 'node:child_process'
import fs from 'node:fs'

const log = (m: string) => fs.appendFileSync('/tmp/vitest-setup.log', m + '\n')

export default async function globalSetup() {
  // globalSetup may run before vitest loads .env — load it explicitly
  const dotenv = await import('dotenv')
  dotenv.config({ path: process.cwd() + '/.env' })

  const testDb = process.env.TEST_DATABASE_URL
  log(`TEST_DATABASE_URL set: ${!!testDb}, value prefix: ${(testDb || '').slice(0, 30)}`)
  if (!testDb) {
    log('SKIP: no test DB')
    return
  }
  log('running db push --force-reset…')
  execSync('npx prisma db push --force-reset --accept-data-loss --skip-generate', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testDb },
    stdio: 'pipe',
  })
  log('db push done')
}
