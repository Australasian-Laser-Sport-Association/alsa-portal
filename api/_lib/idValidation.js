const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function validateUuidList(values, { name = 'ids', max = 500 } = {}) {
  if (!Array.isArray(values)) {
    return { error: `${name} must be an array` }
  }
  if (values.length > max) {
    return { error: `${name} must contain ${max} or fewer ids` }
  }

  const invalid = values.find(value => !isUuid(value))
  if (invalid) {
    return { error: `${name} contains an invalid id` }
  }

  return { ids: values }
}
