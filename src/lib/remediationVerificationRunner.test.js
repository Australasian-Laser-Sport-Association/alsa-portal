import { basename } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DATABASE_URL_ENVIRONMENT_VARIABLE,
  buildLocalPostgresEnvironment,
  discoverRemediationVerificationFiles,
  runRemediationVerifications,
  validateRemediationVerificationCoverage,
} from '../../scripts/run-remediation-verifications.mjs'

const LOCAL_DATABASE_URL =
  'postgresql://verification-user:test-only-password@127.0.0.1:54322/postgres?sslmode=disable'

describe('remediation verification runner', () => {
  it('covers every remediation migration through the admin-content browser contract', () => {
    const names = discoverRemediationVerificationFiles().map(file => basename(file))

    expect(names).toHaveLength(31)
    expect(names[0]).toBe('20260713010000_registration_insert_lockdown_verify.sql')
    expect(names.at(-1)).toBe('20260713066000_admin_content_browser_contract_verify.sql')
    expect(names).toEqual([...names].sort())
  })

  it('rejects missing and orphaned verification artifacts', () => {
    expect(() => validateRemediationVerificationCoverage(
      ['20260713010000_one.sql'],
      ['20260713020000_two_verify.sql'],
    )).toThrow(
      'missing: 20260713010000_one_verify.sql; orphaned: 20260713020000_two_verify.sql',
    )
  })

  it('uses libpq environment variables and keeps credentials out of arguments and logs', () => {
    const calls = []
    const messages = []
    const environment = {
      PATH: 'test-path',
      [DATABASE_URL_ENVIRONMENT_VARIABLE]: LOCAL_DATABASE_URL,
      PGPASSFILE: 'should-not-be-used',
      PGSERVICE: 'should-not-be-used',
    }
    const spawn = vi.fn((binary, args, options) => {
      calls.push({ binary, args, options })
      return { status: 0 }
    })

    const files = runRemediationVerifications({
      databaseUrl: LOCAL_DATABASE_URL,
      environment,
      spawn,
      log: message => messages.push(message),
    })

    expect(files).toHaveLength(31)
    expect(spawn).toHaveBeenCalledTimes(31)
    expect(calls.map(call => basename(call.args.at(-1)))).toEqual(
      files.map(file => basename(file)),
    )
    expect(calls[0].args).toContain('--set=ON_ERROR_STOP=1')
    expect(calls[0].args.join(' ')).not.toContain('test-only-password')
    expect(messages.join('\n')).not.toContain('test-only-password')
    expect(calls[0].options.shell).toBe(false)
    expect(calls[0].options.env).toMatchObject({
      PGHOST: '127.0.0.1',
      PGPORT: '54322',
      PGDATABASE: 'postgres',
      PGUSER: 'verification-user',
      PGPASSWORD: 'test-only-password',
      PGSSLMODE: 'disable',
    })
    expect(calls[0].options.env[DATABASE_URL_ENVIRONMENT_VARIABLE]).toBeUndefined()
    expect(calls[0].options.env.PGPASSFILE).toBeUndefined()
    expect(calls[0].options.env.PGSERVICE).toBeUndefined()
  })

  it('refuses a non-loopback database before starting psql', () => {
    expect(() => buildLocalPostgresEnvironment(
      'postgresql://user:password@database.example.com/postgres',
      {},
    )).toThrow('Refusing to run remediation verification against a non-loopback database host.')
  })

  it('runs every file and reports SQL failures together', () => {
    let callCount = 0
    const spawn = vi.fn(() => {
      callCount += 1
      return { status: callCount === 2 ? 3 : 0 }
    })

    expect(() => runRemediationVerifications({
      databaseUrl: LOCAL_DATABASE_URL,
      environment: {},
      spawn,
      log: () => {},
    })).toThrow(
      '20260713011000_registration_under18_identity_primitives_verify.sql (exit code 3)',
    )
    expect(spawn).toHaveBeenCalledTimes(31)
  })
})
