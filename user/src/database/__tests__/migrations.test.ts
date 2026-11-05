import fs from 'fs'
import mongoose from 'mongoose'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listMigrations, runMigrations } from '../migrations/index.js'

const runs = globalThis as { migrationRuns?: string[] }

// A migrations directory laid out as the image has it: the compiled runner and migrations, a
// declaration file and the README
function compiledMigrations(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'))
  const layout: Record<string, string> = {
    'index.js': "throw new Error('the runner is not a migration')",
    'index.d.ts': 'export {}',
    'README.md': '# Migrations',
    ...files,
  }
  for (const [name, content] of Object.entries(layout)) {
    fs.writeFileSync(path.join(dir, name), content)
  }
  return dir
}

const migration = (label: string) =>
  `export async function up() { globalThis.migrationRuns.push('${label}') }`

const appliedNames = async () =>
  (
    await mongoose.connection
      .collection('migrations')
      .find({}, { projection: { _id: 0, name: 1 } })
      .sort({ name: 1 })
      .toArray()
  ).map(record => record.name)

describe('migration runner', () => {
  beforeEach(() => {
    runs.migrationRuns = []
  })

  afterEach(async () => {
    await mongoose.connection.collection('migrations').deleteMany({})
  })

  it('runs compiled migrations in filename order, each once, and skips everything else', async () => {
    const dir = compiledMigrations({
      '20260102000000-second.js': migration('second'),
      '20260101000000-first.js': migration('first'),
    })

    await runMigrations(dir)
    await runMigrations(dir)

    expect(runs.migrationRuns).toEqual(['first', 'second'])
    expect(await appliedNames()).toEqual(['20260101000000-first', '20260102000000-second'])
  })

  it('does not run again in the image a migration applied from its TypeScript source', async () => {
    await mongoose.connection
      .collection('migrations')
      .insertOne({ name: '20260101000000-first', appliedAt: new Date() })
    const dir = compiledMigrations({ '20260101000000-first.js': migration('first') })

    await runMigrations(dir)

    expect(runs.migrationRuns).toEqual([])
  })

  it('stops at a migration without up() and records nothing for it', async () => {
    const dir = compiledMigrations({
      '20260101000000-broken.js': 'export async function down() {}',
      '20260102000000-later.js': migration('later'),
    })

    await expect(runMigrations(dir)).rejects.toThrow(
      'Migration 20260101000000-broken exports no up() function',
    )
    expect(runs.migrationRuns).toEqual([])
    expect(await appliedNames()).toEqual([])
  })

  it('finds no migration in the source directory today', () => {
    const sourceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

    expect(listMigrations(sourceDir)).toEqual([])
  })
})
