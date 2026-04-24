const PRESETS = {
  long:          { day: 'numeric', month: 'long',  year: 'numeric' },
  short:         { day: 'numeric', month: 'short', year: 'numeric' },
  longWithTime:  { day: 'numeric', month: 'long',  year: 'numeric', hour: '2-digit', minute: '2-digit' },
  shortWithTime: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  monthYear:     { month: 'long', year: 'numeric' },
  numeric:       undefined,
}

export function formatDate(value, preset = 'long') {
  if (value == null || value === '') return ''
  const opts = typeof preset === 'string' ? PRESETS[preset] : preset
  return new Date(value).toLocaleDateString('en-AU', opts)
}
