import { describe, expect, it } from 'vitest'
import { buildCsv, csvCell, neutralizeSpreadsheetFormula } from './csv.js'

describe('CSV spreadsheet safety', () => {
  it.each([
    '=HYPERLINK("https://example.invalid")',
    '+cmd|calc!A0',
    '-1+2',
    '@SUM(1,2)',
    '  =1+1',
    '\t=1+1',
    '\r=1+1',
  ])('neutralizes formula-like string %j', value => {
    expect(neutralizeSpreadsheetFormula(value)).toBe(`'${value}`)
  })

  it('does not alter ordinary strings or numeric negative values', () => {
    expect(neutralizeSpreadsheetFormula('Laser Hawks')).toBe('Laser Hawks')
    expect(csvCell(-250)).toBe('-250')
  })

  it('neutralizes before applying RFC 4180 quoting', () => {
    expect(csvCell('@SUM(1,2)')).toBe('"\'@SUM(1,2)"')
    expect(csvCell('a"b')).toBe('"a""b"')
  })

  it('builds CRLF-delimited CSV with an optional UTF-8 BOM', () => {
    expect(buildCsv(['name'], [['=1+1']], { bom: true }))
      .toBe('\uFEFFname\r\n\'=1+1')
  })
})
