export const DEFAULT_PLANT_AREAS = ['FEED', 'REACTOR', 'PRODUCT', 'WFI', 'AUTOCLAVE', 'LYO', 'CIP', 'TCU', 'PWASTE']

export function areaNameError(name: string): string | null {
  return /^[A-Z][A-Z0-9_-]*$/.test(name)
    ? null : 'Area names must start with a letter and contain only letters, numbers, underscores or hyphens'
}

export function nextAreaName(areas: readonly string[]): string {
  let suffix = 1
  while (areas.includes(`AREA${suffix}`)) suffix++
  return `AREA${suffix}`
}
