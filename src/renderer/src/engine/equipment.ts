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
    'EM-PRODUCT-XFER': { tag: 'EM-PRODUCT-XFER', description: 'Product Transfer', area: 'PRODUCT' }
  }
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
  'XV-201': 'EM-PRODUCT-XFER'
}
