// Spreadsheet applications may interpret user-controlled strings as formulas.
// Prefix those values with an apostrophe so they are displayed as plain text.
// Numeric values remain numeric, including legitimate negative amounts.
const FORMULA_PREFIX = /^[\t\r]|^\s*[=+\-@]/

export function neutralizeSpreadsheetFormula(value) {
  if (typeof value !== 'string' || !FORMULA_PREFIX.test(value)) return value
  return `'${value}`
}

export function csvCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(neutralizeSpreadsheetFormula(value))
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvRow(values) {
  return values.map(csvCell).join(',')
}

export function buildCsv(headers, rows, { bom = false } = {}) {
  const prefix = bom ? '\uFEFF' : ''
  return prefix + [csvRow(headers), ...rows.map(csvRow)].join('\r\n')
}

export function downloadCsv(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
