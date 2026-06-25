export const PASSWORD_MIN_LENGTH = 10

export const PASSWORD_REQUIREMENT_TEXT = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return PASSWORD_REQUIREMENT_TEXT
  }
  return ''
}
