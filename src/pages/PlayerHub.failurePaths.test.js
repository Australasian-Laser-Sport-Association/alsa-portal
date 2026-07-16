import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = await readFile(new URL('./PlayerHub.jsx', import.meta.url), 'utf8')

function sliceBetween(text, start, end) {
  const startIndex = text.indexOf(start)
  const endIndex = text.indexOf(end, startIndex + start.length)
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Could not find PlayerHub source markers: ${start} -> ${end}`)
  }
  return text.slice(startIndex, endIndex)
}

const doublesSelector = sliceBetween(
  source,
  'function DoublesSelector',
  'function TriplesSelector'
)
const triplesSelector = sliceBetween(
  source,
  'function TriplesSelector',
  '// ── Main Page'
)
const mainPage = source.slice(source.indexOf('export default function PlayerHub'))

function expectFailureSafe(section, errorSetter, pendingSetter) {
  expect(section).toContain('catch (err)')
  expect(section).toContain(`${errorSetter}(`)
  expect(section).toContain('finally')
  expect(section).toContain(`${pendingSetter}(false)`)
}

describe('PlayerHub doubles and triples failure paths', () => {
  it('reports search failures and always clears searching state', () => {
    const doublesSearch = sliceBetween(doublesSelector, 'async function runSearch', 'async function invite')
    const triplesSearch = sliceBetween(triplesSelector, 'async function runSearch', 'async function inviteToSlot')

    expectFailureSafe(doublesSearch, 'setError', 'setSearching')
    expectFailureSafe(triplesSearch, 'setError', 'setSearching')
    expect(doublesSelector).toContain('{error && <p role="alert"')
    expect(triplesSelector).toContain('{error && <p role="alert"')
  })

  it('reports selector mutation failures and always clears saving state', () => {
    const doublesChange = sliceBetween(doublesSelector, 'async function changePartner', 'if (record)')
    const triplesClear = sliceBetween(triplesSelector, 'async function clearSlot', 'async function disbandTeam')
    const triplesDisband = sliceBetween(triplesSelector, 'async function disbandTeam', 'const p2confirmed')

    expectFailureSafe(doublesChange, 'setError', 'setSaving')
    expectFailureSafe(triplesClear, 'setError', 'setSaving')
    expectFailureSafe(triplesDisband, 'setError', 'setSaving')
  })

  it('surfaces invitation failures and disables actions while saving', () => {
    const doublesResponse = sliceBetween(
      mainPage,
      'async function respondToDoublesInvitation',
      'async function respondToTriplesInvitation'
    )
    const triplesResponse = sliceBetween(
      mainPage,
      'async function respondToTriplesInvitation',
      'async function confirmSideEvents'
    )

    expectFailureSafe(doublesResponse, 'setDoublesInvitationError', 'setDoublesInvitationSaving')
    expectFailureSafe(triplesResponse, 'setTriplesInvitationError', 'setTriplesInvitationSaving')
    expect(mainPage).toContain('disabled={doublesInvitationSaving}')
    expect(mainPage).toContain('disabled={triplesInvitationSaving}')
    expect(mainPage).toContain('{doublesInvitationError &&')
    expect(mainPage).toContain('{triplesInvitationError &&')
  })
})
