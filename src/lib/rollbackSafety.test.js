import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const rollbackDirectory = resolve(process.cwd(), 'supabase', 'rollback')

const expectedVersions = [
  '20260713010000',
  '20260713011000',
  '20260713012000',
  '20260713013000',
  '20260713020000',
  '20260713030000',
  '20260713031000',
  '20260713032000',
  '20260713033000',
  '20260713040000',
  '20260713041000',
  '20260713042000',
  '20260713043000',
  '20260713044000',
  '20260713050000',
  '20260713051000',
  '20260713052000',
  '20260713053000',
  '20260713054000',
  '20260713055000',
  '20260713056000',
  '20260713057000',
  '20260713058000',
  '20260713059000',
  '20260713060000',
  '20260713061000',
  '20260713062000',
  '20260713063000',
  '20260713064000',
  '20260713065000',
  '20260713065500',
  '20260713066000',
  '20260713067000',
]

function remediationRollbacks() {
  return readdirSync(rollbackDirectory)
    .filter(name => /^20260713\d{6}_.+_rollback\.sql$/.test(name))
    .sort()
}

function executableSql(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim()
}

describe('20260713 production rollback safety', () => {
  it('covers every remediation migration through final release hardening', () => {
    const versions = remediationRollbacks().map(name => name.slice(0, 14))
    expect(versions).toEqual(expectedVersions)
  })

  it('keeps every remediation downgrade explicitly fail closed', () => {
    for (const name of remediationRollbacks()) {
      const source = readFileSync(resolve(rollbackDirectory, name), 'utf8')
      const sql = executableSql(source)
      const controlSql = sql.replace(/'(?:''|[^'])*'/g, "''")

      expect(source, name).toContain('ROLL_FORWARD_ONLY_SECURITY_BOUNDARY')
      expect(sql, name).toMatch(/\bRAISE\s+EXCEPTION\b/i)

      // A remediation rollback may explain the boundary and raise. It must not
      // restore privileges/policies/views or remove schema, state, or evidence.
      expect(controlSql, name).not.toMatch(
        /\b(?:GRANT|REVOKE|ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
      )
      expect(sql.match(/\bRAISE\s+EXCEPTION\b/gi), name).toHaveLength(1)
    }
  })

  it('documents the exact reverse dependency order and forbids history repair', () => {
    const readme = readFileSync(resolve(rollbackDirectory, 'README.md'), 'utf8')
    const reverseNames = remediationRollbacks().reverse()
    let previousIndex = -1

    for (const name of reverseNames) {
      const index = readme.indexOf(`\`${name}\``)
      expect(index, `${name} is missing from rollback README`).toBeGreaterThan(-1)
      expect(index, `${name} is out of reverse dependency order`).toBeGreaterThan(previousIndex)
      previousIndex = index
    }

    expect(readme).toContain('Never mark a roll-forward-only migration as reverted')
    expect(readme).toContain('Do not execute that list')
  })
})
