export const PASSWORD_MIN_LENGTH = 10

export const PASSWORD_REQUIREMENT_TEXT = `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include a lowercase letter, uppercase letter, and number.`

export function validatePassword(password) {
  if (
    typeof password !== 'string'
    || password.length < PASSWORD_MIN_LENGTH
    || !/[a-z]/.test(password)
    || !/[A-Z]/.test(password)
    || !/[0-9]/.test(password)
  ) {
    return PASSWORD_REQUIREMENT_TEXT
  }
  return ''
}
