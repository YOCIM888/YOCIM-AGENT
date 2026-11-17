import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/database'
import { ProjectConventionRepository, ProjectRepository } from '../../src/main/db/repositories'

function createDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

describe('ProjectConventionRepository', () => {
  it('isolates conventions by project and overwrites only the target project', () => {
    const db = createDb()
    const projects = new ProjectRepository(db)
    const repo = new ProjectConventionRepository(db)
    const a = projects.ensure('/tmp/project-a')
    const b = projects.ensure('/tmp/project-b')

    expect(repo.get(a.id)).toBeNull()
    const saved = repo.save(a.id, '# A 约定', 'manual', 'user')
    expect(saved).toMatchObject({
      projectId: a.id,
      content: '# A 约定',
      source: 'manual',
      updatedBy: 'user'
    })
    expect(saved.updatedAt).toBeGreaterThan(0)
    expect(repo.get(b.id)).toBeNull()

    repo.save(a.id, '# A 约定 v2', 'ai', 'ai')
    expect(repo.get(a.id)).toMatchObject({ content: '# A 约定 v2', source: 'ai', updatedBy: 'ai' })
    repo.save(b.id, '# B 约定')
    expect(repo.get(a.id)?.content).toBe('# A 约定 v2')
  })

  it('removes only the requested convention and cascades on project deletion', () => {
    const db = createDb()
    const projects = new ProjectRepository(db)
    const repo = new ProjectConventionRepository(db)
    const a = projects.ensure('/tmp/a')
    const b = projects.ensure('/tmp/b')
    repo.save(a.id, 'A')
    repo.save(b.id, 'B')

    expect(repo.remove(a.id)).toBe(true)
    expect(repo.remove(a.id)).toBe(false)
    expect(repo.get(b.id)?.content).toBe('B')

    projects.delete(b.id)
    expect(repo.get(b.id)).toBeNull()
  })
})
