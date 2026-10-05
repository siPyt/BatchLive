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
  /** DV09-013: the Unit this equipment module sits under; undefined means it hangs directly under its area. */
  unit?: string
}

/** Seed Equipment Modules grouping the built-in plant's Control Modules. */
export function makeDefaultEquipment(): Record<string, EquipmentModule> {
  return {
    'EM-FEED-SUPPLY': { tag: 'EM-FEED-SUPPLY', description: 'Feed Supply', area: 'FEED' },
    'EM-REACTOR-AGITATE': { tag: 'EM-REACTOR-AGITATE', description: 'Reactor Level & Agitation', area: 'REACTOR' },
    'EM-PRODUCT-XFER': { tag: 'EM-PRODUCT-XFER', description: 'Product Transfer', area: 'PRODUCT' },
    'EM-WFI-LOOP': { tag: 'EM-WFI-LOOP', description: 'WFI Generation & Distribution Loop (2 Stills)', area: 'WFI' },
    'EM-AUTOCLAVE-1': { tag: 'EM-AUTOCLAVE-1', description: 'Autoclave 1 (Steam Sterilizer)', area: 'AUTOCLAVE' },
    'EM-AUTOCLAVE-2': { tag: 'EM-AUTOCLAVE-2', description: 'Autoclave 2 (Steam Sterilizer)', area: 'AUTOCLAVE' },
    'EM-LYO-1': { tag: 'EM-LYO-1', description: 'Lyophilizer 1 (Freeze Dryer)', area: 'LYO' },
    'EM-LYO-2': { tag: 'EM-LYO-2', description: 'Lyophilizer 2 (Freeze Dryer)', area: 'LYO' },
    'EM-CIP-1': { tag: 'EM-CIP-1', description: 'CIP Skid 1 (Reactor Train)', area: 'CIP' },
    'EM-CIP-2': { tag: 'EM-CIP-2', description: 'CIP Skid 2 (WFI/Autoclave/Lyo)', area: 'CIP' },
    'EM-CIP-3': { tag: 'EM-CIP-3', description: 'CIP Skid 3 (Product/Filling)', area: 'CIP' },
    'EM-TCU-1': { tag: 'EM-TCU-1', description: 'TCU 1 (Reactor Jacket)', area: 'TCU' },
    'EM-TCU-2': { tag: 'EM-TCU-2', description: 'TCU 2 (Lyophilizer 1 Shelves)', area: 'TCU' },
    'EM-TCU-3': { tag: 'EM-TCU-3', description: 'TCU 3 (Lyophilizer 2 Shelves)', area: 'TCU' }
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
  'FI-401': 'EM-WFI-LOOP',
  'LIC-401': 'EM-WFI-LOOP',
  'PIC-401': 'EM-WFI-LOOP',
  'AT-401': 'EM-WFI-LOOP',
  'TI-402': 'EM-WFI-LOOP',
  'P-401': 'EM-WFI-LOOP',
  'XV-401': 'EM-WFI-LOOP',
  'TIC-411': 'EM-WFI-LOOP',
  'FI-411': 'EM-WFI-LOOP',
  'P-402': 'EM-WFI-LOOP',
  'XV-411': 'EM-WFI-LOOP',
  'TIC-501': 'EM-AUTOCLAVE-1',
  'PIC-501': 'EM-AUTOCLAVE-1',
  'XV-501': 'EM-AUTOCLAVE-1',
  'DI-501': 'EM-AUTOCLAVE-1',
  'TIC-511': 'EM-AUTOCLAVE-2',
  'PIC-511': 'EM-AUTOCLAVE-2',
  'XV-511': 'EM-AUTOCLAVE-2',
  'DI-511': 'EM-AUTOCLAVE-2',
  'TIC-601': 'EM-LYO-1',
  'PIC-601': 'EM-LYO-1',
  'AT-601': 'EM-LYO-1',
  'XV-601': 'EM-LYO-1',
  'TIC-611': 'EM-LYO-2',
  'PIC-611': 'EM-LYO-2',
  'AT-611': 'EM-LYO-2',
  'XV-611': 'EM-LYO-2',
  'TIC-701': 'EM-CIP-1',
  'FIC-701': 'EM-CIP-1',
  'AT-701': 'EM-CIP-1',
  'P-701': 'EM-CIP-1',
  'XV-701': 'EM-CIP-1',
  'XV-702': 'EM-CIP-1',
  'TIC-711': 'EM-CIP-2',
  'FIC-711': 'EM-CIP-2',
  'AT-711': 'EM-CIP-2',
  'P-711': 'EM-CIP-2',
  'XV-711': 'EM-CIP-2',
  'XV-712': 'EM-CIP-2',
  'TIC-721': 'EM-CIP-3',
  'FIC-721': 'EM-CIP-3',
  'AT-721': 'EM-CIP-3',
  'P-721': 'EM-CIP-3',
  'XV-721': 'EM-CIP-3',
  'XV-722': 'EM-CIP-3',
  'TIC-801': 'EM-TCU-1',
  'FIC-801': 'EM-TCU-1',
  'P-801': 'EM-TCU-1',
  'HS-801': 'EM-TCU-1',
  'TIC-811': 'EM-TCU-2',
  'FIC-811': 'EM-TCU-2',
  'P-811': 'EM-TCU-2',
  'HS-811': 'EM-TCU-2',
  'TIC-821': 'EM-TCU-3',
  'FIC-821': 'EM-TCU-3',
  'P-821': 'EM-TCU-3',
  'HS-821': 'EM-TCU-3'
}
