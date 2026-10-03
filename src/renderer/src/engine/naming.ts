export const MAX_DELTAV_TAG_LENGTH = 16

export function isValidDeltaVTag(tag: string): boolean {
  return tag.length > 0 && tag.length <= MAX_DELTAV_TAG_LENGTH &&
    /[A-Za-z]/.test(tag) && /^[A-Za-z0-9_$-]+$/.test(tag)
}

export function moduleNameError(tag: string): string | null {
  return isValidDeltaVTag(tag) ? null :
    'Module tag must be 1-16 characters, contain a letter, and use only letters, digits, $, - or _.'
}
