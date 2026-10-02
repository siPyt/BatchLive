// ---------------------------------------------------------------------------
// DeltaV ISA-88 physical model: Process Cell > Area > Unit > Equipment Module
// > Control Module. An Equipment Module groups the Control Modules that make
// up one piece of equipment (e.g. an agitator + its level/temp loops) — it
// does not itself run phase logic (that belongs to the Unit).
// ---------------------------------------------------------------------------

export interface EquipmentModule {
  tag: string
  description: string
  area: string
}

/** Seed Equipment Modules grouping the built-in plant's Control Modules. */
export function makeDefaultEquipment(): Record<string, EquipmentModule> {
  return {
    'EM-FEED-SUPPLY': { tag: 'EM-FEED-SUPPLY', description: 'Feed Supply', area: 'FEED' },
    'EM-REACTOR-AGITATE': { tag: 'EM-REACTOR-AGITATE', description: 'Reactor Level & Agitation', area: 'REACTOR' },
    'EM-PRODUCT-XFER': { tag: 'EM-PRODUCT-XFER', description: 'Product Transfer', area: 'PRODUCT' },
    'EM-WFI-LOOP': { tag: 'EM-WFI-LOOP', description: 'WFI Generation & Distribution Loop', area: 'WFI' },
    'EM-AUTOCLAVE-1': { tag: 'EM-AUTOCLAVE-1', description: 'Autoclave 1 (Steam Sterilizer)', area: 'AUTOCLAVE' },
    'EM-LYO-1': { tag: 'EM-LYO-1', description: 'Lyophilizer 1 (Freeze Dryer)', area: 'LYO' }
  }
}

/** Empty project: no Equipment Modules. */
export function makeBlankEquipment(): Record<string, EquipmentModule> {
  return {}
}

/** Which Equipment Module each built-in Control Module belongs to by default. */
export const DEFAULT_MEMBERSHIP: Record<string, string> = {
  'FIC-101': 'EM-FEED-SUPPLY',
  'LIC-101': 'EM-FEED-SUPPLY',
  'P-101': 'EM-FEED-SUPPLY',
  'XV-101': 'EM-FEED-SUPPLY',
  'TI-101': 'EM-FEED-SUPPLY',
  'LSH-101': 'EM-FEED-SUPPLY',
  'LIC-201': 'EM-REACTOR-AGITATE',
  'TIC-201': 'EM-REACTOR-AGITATE',
  'HS-201': 'EM-REACTOR-AGITATE',
  'PIC-301': 'EM-PRODUCT-XFER',
  'AT-301': 'EM-PRODUCT-XFER',
  'P-201': 'EM-PRODUCT-XFER',
  'XV-201': 'EM-PRODUCT-XFER',
  'TIC-401': 'EM-WFI-LOOP',
  'LIC-401': 'EM-WFI-LOOP',
  'PIC-401': 'EM-WFI-LOOP',
  'AT-401': 'EM-WFI-LOOP',
  'TI-402': 'EM-WFI-LOOP',
  'P-401': 'EM-WFI-LOOP',
  'XV-401': 'EM-WFI-LOOP',
  'TIC-501': 'EM-AUTOCLAVE-1',
  'PIC-501': 'EM-AUTOCLAVE-1',
  'XV-501': 'EM-AUTOCLAVE-1',
  'DI-501': 'EM-AUTOCLAVE-1',
  'TIC-601': 'EM-LYO-1',
  'PIC-601': 'EM-LYO-1',
  'AT-601': 'EM-LYO-1',
  'XV-601': 'EM-LYO-1'
}
