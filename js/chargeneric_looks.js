import { armorAtlas, swatch as S, PAINT, VY } from './chargeneric_paint.js';

// ===========================================================================
// Archetype LOOKS.  A look is a discrete outfit/body/face combination whose geometry + atlas layout is
// cached; per spawn chargeneric.js adds a seeded palette, skin tone, hair colour and height/bulk jitter.
// Each style has its own outer-garment ("armor") atlas listed here.
// ===========================================================================
const P = PAINT;
const torso = (name, o) => S(name, 512, 192, P.paintTorso, o);
const sleeve = (name, o) => S(name, 128, 192, P.paintSleeve, o);
const common = () => [
  S('strap', 32, 32, P.paintStrap, { slot: 'B' }), S('pouch', 64, 64, P.paintPouch, {}), S('visor', 64, 32, P.paintVisor, { slot: 'B', shade: 120, metal: 0.6 }), S('visorTint', 64, 32, P.paintVisor, { slot: 'C', shade: 105, metal: 0.55 }),
  S('kneepad', 64, 64, P.paintPlate, { slot: 'B', rough: 0.5, metal: 0.1, lines: [], scuffs: 20 }), S('metalA', 32, 32, P.paintMetal, {}),
];

// ----------------------------------------------------------------------------------------------- atlases
const ATLAS = {
  thug: () => [
    ...common(),
    torso('bomber', { fabric: 'satin', zip: true, rib: true, pockets: [{ u: 0.05, y: 1.22, w: 0.07, h: 0.12, slant: true }], logo: { kind: 'skull', y: 1.48, size: 0.3, chest: true, rocker: true }, backYoke: true }),
    sleeve('bomberSleeve', { fabric: 'satin', rib: true, patch: 'bolt' }),
    S('bomberCollar', 128, 32, P.paintCollar, { slot: 'B', tip: true }),
    torso('hoodie', { fabric: 'cotton', rib: true, ribH: 16, pockets: [{ u: -0.09, y: 1.24, w: 0.18, h: 0.13, mirror: false }, { u: 0.91, y: 1.24, w: 0.18, h: 0.13, mirror: false }], logo: { kind: 'crown', y: 1.5, size: 0.28, chest: false }, creases: 12 }),
    sleeve('hoodieSleeve', { fabric: 'cotton', rib: true, ribSlot: 'A' }),
    S('hoodieHood', 128, 96, P.paintHood, { fabric: 'cotton' }),
    torso('leather', { fabric: 'leather', zip: true, gapU: 0.0, pockets: [{ u: 0.06, y: 1.3, w: 0.06, h: 0.0, welt: true }, { u: 0.07, y: 1.6, w: 0.05, h: 0.0, welt: true }], logo: { kind: 'flame', y: 1.45, size: 0.32, ring: true }, studs: [[0.2, 1.78], [0.23, 1.78], [0.26, 1.78], [0.74, 1.78], [0.77, 1.78], [0.8, 1.78]], princess: true, grime: 0.4 }),
    sleeve('leatherSleeve', { fabric: 'leather', cuffZip: true }),
    S('leatherCollar', 128, 32, P.paintCollar, { slot: 'A', fabric: 'leather', rib: false }),
    torso('vest', { fabric: 'denim', buttons: 22, pockets: [{ u: 0.07, y: 1.62, w: 0.08, h: 0.08, flap: true, button: true }], logo: { kind: 'rat', y: 1.45, size: 0.36, rocker: true, ring: false }, frayHem: true, grime: 0.45 }),
    torso('track', { fabric: 'nylon', zip: true, rib: true, ribSlot: 'A', stripes: [{ u0: 0.235, u1: 0.265, y0: 0.86, y1: 1.92 }, { u0: 0.735, u1: 0.765, y0: 0.86, y1: 1.92 }], panels: [{ pts: [[0, 1.92], [1, 1.92], [1, 1.66], [0.75, 1.62], [0.5, 1.66], [0.25, 1.62], [0, 1.66]], slot: 'B' }], logo: { kind: 'star', y: 1.52, size: 0.18, chest: true } }),
    sleeve('trackSleeve', { fabric: 'nylon', stripes: [{ u0: 0.21, u1: 0.29, slot: 'C' }], rib: true, ribSlot: 'A' }),
    S('trackCollar', 128, 32, P.paintCollar, { slot: 'B' }),
    S('cap', 128, 96, P.paintCap, { logo: 'bolt' }),
    S('beanie', 128, 64, P.paintBeanie, { stripe: true }),
    S('bandana', 128, 64, P.paintBandana, {}),
  ],
  gunman: () => [
    ...common(),
    torso('plateCarrier', { fabric: 'nylon', webbing: [1.32, 1.6], panels: [{ pts: [[0.22, 1.75], [0.28, 1.75], [0.28, 0.86], [0.22, 0.86]], slot: 'B' }, { pts: [[0.72, 1.75], [0.78, 1.75], [0.78, 0.86], [0.72, 0.86]], slot: 'B' }], logo: { kind: 'eye', y: 1.68, size: 0.12, chest: false }, grime: 0.4 }),
    torso('fieldJacket', { fabric: 'canvas', zip: true, snaps: true, pockets: [{ u: 0.05, y: 1.65, w: 0.08, h: 0.1, flap: true, button: true }, { u: 0.05, y: 1.3, w: 0.09, h: 0.13, flap: true, button: true }], backYoke: true, grime: 0.45, creases: 10 }),
    sleeve('fieldSleeve', { fabric: 'canvas', patch: 'eye', elbowPad: true }),
    torso('fieldCamo', { fabric: 'canvas', camo: { size: 11 }, zip: true, snaps: true, pockets: [{ u: 0.05, y: 1.65, w: 0.08, h: 0.1, flap: true, button: true }, { u: 0.05, y: 1.3, w: 0.09, h: 0.13, flap: true, button: true }], backYoke: true, grime: 0.4, creases: 8 }),
    sleeve('fieldCamoSleeve', { fabric: 'canvas', camo: { size: 9 }, patch: 'eye', elbowPad: true }),
    S('fieldCollar', 128, 32, P.paintCollar, { slot: 'A', fabric: 'canvas', rib: false }),
    S('capTac', 128, 96, P.paintCap, { logo: 'eye', fabric: 'canvas' }),
    S('beanie', 128, 64, P.paintBeanie, {}),
    S('balaclava', 128, 128, P.paintBeanie, {}),
    S('respirator', 64, 64, P.paintPlate, { slot: 'B', rough: 0.55, metal: 0.1, lines: [[0.5, 0, 0.5, 1]], scuffs: 10, grime: 0.2 }),
    S('goggles', 64, 32, P.paintPlate, { slot: 'B', rough: 0.4, metal: 0.2, lines: [], scuffs: 8 }),
    S('holster', 64, 64, P.paintPouch, { slot: 'B', fabric: 'leather' }),
    S('bandana', 128, 64, P.paintBandana, {}),
  ],
  brute: () => [
    ...common(),
    S('plateChest', 256, 128, P.paintPlate, { hazard: 0.16, rivets: 18, lines: [[0.5, 0, 0.5, 0.84], [0, 0.45, 1, 0.45]], number: true }),
    S('plateArm', 128, 128, P.paintPlate, { hazard: 0.2, rivets: 14, lines: [[0, 0.5, 1, 0.5]] }),
    S('plateLeg', 128, 128, P.paintPlate, { rivets: 16, lines: [[0, 0.33, 1, 0.33], [0, 0.66, 1, 0.66]] }),
    torso('riotSuit', { fabric: 'canvas', panels: [{ pts: [[0.2, 1.92], [0.3, 1.92], [0.3, 0.86], [0.2, 0.86]], slot: 'B' }, { pts: [[0.7, 1.92], [0.8, 1.92], [0.8, 0.86], [0.7, 0.86]], slot: 'B' }], grime: 0.5, creases: 14 }),
    sleeve('riotSleeve', { fabric: 'canvas', elbowPad: true, grime: 0.45 }),
    S('helmetRiot', 256, 128, P.paintHelmet, { hazard: true, vents: true, scratches: true, rough: 0.35, metal: 0.3 }),
  ],
  junkie: () => [
    ...common(),
    torso('ragHoodie', { fabric: 'cotton', rib: true, tears: 9, frayHem: true, grime: 0.6, pockets: [{ u: -0.09, y: 1.24, w: 0.18, h: 0.13, mirror: false }, { u: 0.91, y: 1.24, w: 0.18, h: 0.13, mirror: false }], graffiti: true, creases: 16 }),
    sleeve('ragSleeve', { fabric: 'cotton', tears: 6, grime: 0.6 }),
    S('ragHood', 128, 96, P.paintHood, { fabric: 'cotton' }),
    torso('ragTank', { fabric: 'knit', tears: 6, frayHem: true, grime: 0.65, logo: { kind: 'eye', y: 1.55, size: 0.22, back: true } }),
    torso('ragJacket', { fabric: 'nylon', zip: true, tears: 7, grime: 0.6, stripes: [{ u0: 0.0, u1: 1.0, y0: 1.56, y1: 1.6, slot: 'C' }], creases: 12 }),
    sleeve('ragJacketSleeve', { fabric: 'nylon', tears: 5, stripes: [{ u0: 0.2, u1: 0.3, slot: 'C' }], grime: 0.55 }),
    S('beanie', 128, 64, P.paintBeanie, {}),
  ],
  biker: () => [
    ...common(),
    torso('leathers', { fabric: 'leather', zip: true, panels: [{ pts: [[0.0, 1.62], [0.12, 1.66], [0.12, 1.2], [0.0, 1.16]], slot: 'B' }, { pts: [[0.88, 1.66], [1.0, 1.62], [1.0, 1.16], [0.88, 1.2]], slot: 'B' }, { pts: [[0.38, 1.85], [0.62, 1.85], [0.6, 1.3], [0.4, 1.3]], slot: 'B' }], stripes: [{ u0: 0.13, u1: 0.16, y0: 0.86, y1: 1.9 }, { u0: 0.84, u1: 0.87, y0: 0.86, y1: 1.9 }], logo: { kind: 'flame', y: 1.5, size: 0.28, chest: true, chestU: 0.08 }, grime: 0.25 }),
    sleeve('leathersSleeve', { fabric: 'leather', stripes: [{ u0: 0.22, u1: 0.28, slot: 'C' }], armor: true, cuffZip: true, grime: 0.25 }),
    S('leathersCollar', 128, 32, P.paintCollar, { slot: 'B', fabric: 'leather', rib: false }),
    S('helmet', 256, 128, P.paintHelmet, { stripe: true, rough: 0.12, metal: 0.25 }),
    S('helmetFlames', 256, 128, P.paintHelmet, { flames: true, rough: 0.12, metal: 0.25 }),
  ],
  boss: () => [
    ...common(),
    torso('coat', { fabric: 'leather', buttons: 26, buttonSlot: 'D', pockets: [{ u: 0.06, y: 1.08, w: 0.09, h: 0.0, welt: true }], backYoke: true, princess: true, grime: 0.25 }),
    sleeve('coatSleeve', { fabric: 'leather', grime: 0.2 }),
    S('fur', 128, 64, P.paintFur, { slot: 'B' }),
    torso('suitVest', { fabric: 'wool', buttons: 16, buttonSlot: 'D', pockets: [{ u: 0.06, y: 1.62, w: 0.06, h: 0.0, welt: true }] }),
    S('coatTail', 128, 160, P.paintSleeve, { fabric: 'leather', grime: 0.2 }),
    S('plateBoss', 128, 128, P.paintPlate, { slot: 'B', rivets: 12, lines: [[0, 0.5, 1, 0.5]], rough: 0.32, metal: 0.6 }),
    S('chainGold', 32, 32, P.paintMetal, { slot: 'D', shade: 210, rough: 0.22 }),
  ],
  civ: () => [
    ...common(),
    torso('coatCiv', { fabric: 'wool', buttons: 24, pockets: [{ u: 0.06, y: 1.14, w: 0.08, h: 0.1, flap: true }], backYoke: true }),
    sleeve('coatCivSleeve', { fabric: 'wool' }),
    S('coatCivCollar', 128, 32, P.paintCollar, { slot: 'A', fabric: 'wool', rib: false }),
    torso('parka', { fabric: 'nylon', zip: true, snaps: true, pockets: [{ u: 0.05, y: 1.24, w: 0.1, h: 0.13, flap: true }], panels: [{ pts: [[0, 1.92], [1, 1.92], [1, 1.7], [0, 1.7]], slot: 'B' }], creases: 10 }),
    sleeve('parkaSleeve', { fabric: 'nylon', rib: true }),
    S('parkaHood', 128, 96, P.paintHood, { fabric: 'nylon' }),
    torso('blazer', { fabric: 'wool', buttons: 40, pockets: [{ u: 0.06, y: 1.18, w: 0.08, h: 0.0, welt: true }, { u: 0.08, y: 1.62, w: 0.05, h: 0.0, welt: true }], princess: true }),
    sleeve('blazerSleeve', { fabric: 'wool' }),
    S('blazerCollar', 128, 32, P.paintCollar, { slot: 'A', fabric: 'wool', rib: false }),
    torso('cardigan', { fabric: 'knit', buttons: 18, rib: true, ribSlot: 'A', pockets: [{ u: 0.06, y: 1.22, w: 0.09, h: 0.1 }] }),
    sleeve('cardiganSleeve', { fabric: 'knit', rib: true, ribSlot: 'A' }),
    torso('raincoat', { fabric: 'vinyl', buttons: 26, pockets: [{ u: 0.06, y: 1.12, w: 0.08, h: 0.1, flap: true }] }),
    sleeve('raincoatSleeve', { fabric: 'vinyl' }),
    torso('sweatshirt', { fabric: 'cotton', rib: true, logo: { kind: 'star', y: 1.55, size: 0.2, back: false, chest: true, chestU: 0.0 } }),
    sleeve('sweatshirtSleeve', { fabric: 'cotton', rib: true }),
    S('fedora', 128, 96, P.paintCap, { fabric: 'wool' }),
    S('beanie', 128, 64, P.paintBeanie, {}),
    S('cap', 128, 96, P.paintCap, {}),
    S('bagLeather', 64, 64, P.paintPouch, { slot: 'B', fabric: 'leather' }),
    S('scarf', 64, 64, P.paintBeanie, { stripe: true }),
  ],
};
export function atlasFor(style) { return armorAtlas(style, ATLAS[style] ? ATLAS[style]() : ATLAS.thug()); }

// ----------------------------------------------------------------------------------------------- palettes
export const SKIN_TONES = [0xf2cdb0, 0xe0b090, 0xc99670, 0xa8774e, 0x86593a, 0x5e3c26, 0x3f2618];
export const HAIR = { dark: [0x14100d, 0x241810, 0x3a2416, 0x5a3a20], light: [0x8a5a30, 0xb08850, 0xd0b070, 0x8a2e14], gray: [0x8a8a88, 0xb8b8b4, 0xdedcd8], dyed: [0xd0204a, 0x2a8ae0, 0x7ae030, 0xe060c0, 0xe0d020] };
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
export const PALETTES = {
  thug: (r) => ({
    armor: [pick(r, [0x2a2e35, 0x5a1c1c, 0x1d3150, 0x3a3e20, 0x6a4418, 0x121316, 0x7a2c10, 0x253a2a]), pick(r, [0xd8a830, 0xb81c1c, 0xd8d8d0, 0xe06a10, 0x18a0a0, 0x7a20a0]), pick(r, [0xf0c020, 0xe03018, 0xf0f0e8, 0x20c8e0, 0xf07018, 0xa0e030]), pick(r, [0xb4b4bc, 0xc89a40])],
    under: [pick(r, [0x2a3c66, 0x1a2236, 0x3a3a42, 0x222224, 0x4a4430, 0x30343a]), pick(r, [0xdcdcd4, 0x8a1c1c, 0x1c1c1c, 0x5c6470, 0xc89030, 0x2c5a3a]), pick(r, [0x1a1410, 0x3a2414, 0x141418, 0x4a3a2a]), 0xb8b8c0],
    hair: pick(r, r() < 0.12 ? HAIR.dyed : r() < 0.25 ? HAIR.light : HAIR.dark),
  }),
  gunman: (r) => ({
    armor: [pick(r, [0x4a5232, 0x6e5c40, 0x4e5258, 0x1c1e22, 0x2a3242, 0x3c4430]), pick(r, [0x2a2e22, 0x3e3426, 0x2e3034, 0x4a4436]), pick(r, [0xe03020, 0xf0a020, 0x40e0ff, 0xe0e0e0]), pick(r, [0x8a8a90, 0x60646a])],
    under: [pick(r, [0x4a4c38, 0x5a4e3a, 0x45484c, 0x24262a, 0x3a4030]), pick(r, [0x2e3224, 0x6a6048, 0x5a5e62, 0x3a3830]), pick(r, [0x1a1814, 0x2a2018, 0x141416]), 0x9a9aa0],
    hair: pick(r, HAIR.dark),
  }),
  brute: (r) => ({
    armor: [pick(r, [0x5a5e64, 0x3e4a3a, 0x4a4036, 0x2e3440, 0x6a5a3a]), pick(r, [0x1e2022, 0x2a2622, 0x26302a]), pick(r, [0xf0c018, 0xe05a10, 0xd8d8d0]), pick(r, [0xa0a0a8, 0x8a8070])],
    under: [pick(r, [0x2a2c2a, 0x3a342a, 0x26282e]), pick(r, [0x343028, 0x2a2e26]), pick(r, [0x18160f, 0x201a14]), 0x909098],
    hair: pick(r, HAIR.dark),
  }),
  junkie: (r) => ({
    armor: [pick(r, [0x4a3a5a, 0x2e5a50, 0x5a3a2a, 0x3a3a3a, 0x6a2a4a, 0x50582a]), pick(r, [0x2a2a2a, 0x40304a, 0x2a4038]), pick(r, [0x8aff40, 0xff40c0, 0x40e0ff]), 0x909090],
    under: [pick(r, [0x2a3a58, 0x303030, 0x4a4030, 0x3a2a3a]), pick(r, [0x8a8a7a, 0x5a6a40, 0x6a4a5a, 0xa0a090]), pick(r, [0x3a3a3a, 0x2a2420, 0x50483a]), 0xa0a0a0],
    hair: pick(r, r() < 0.5 ? HAIR.dyed : HAIR.light),
  }),
  biker: (r) => ({
    armor: [pick(r, [0x14141a, 0x5a1018, 0x1a2a4a, 0x2a2a2a]), pick(r, [0xb01828, 0xd0d0d0, 0xe0a010, 0x1a1a1a, 0x2050c0]), pick(r, [0xff3020, 0xf0f0f0, 0xffb020, 0x30a0ff]), pick(r, [0x9a9aa4, 0xc8a040])],
    under: [pick(r, [0x16161a, 0x22201e, 0x2a1a1a]), pick(r, [0x1a1a1a, 0x5a1a1a]), pick(r, [0x0e0e10, 0x1a1410]), 0xa8a8b0],
    hair: pick(r, HAIR.dark),
  }),
  boss: (r) => ({
    armor: [pick(r, [0x5a1016, 0x1a1214, 0x2e1838, 0x3e2614, 0x101e30, 0x5a0a22]), pick(r, [0xe8e0d2, 0xd0c0a4, 0xdcdcdc, 0xb8a888]), pick(r, [0xe8b52a, 0xd0d0d0]), pick(r, [0xe8b52a, 0xf0c848])],
    under: [pick(r, [0x1a1416, 0x22201e, 0x2a2026]), pick(r, [0xe8e4dc, 0x8a1418, 0x1a1a1a, 0xc8a040]), pick(r, [0x0e0c0a, 0x2a1a10]), 0xe8b52a],
    hair: pick(r, HAIR.dark),
  }),
  civ: (r) => ({
    armor: [pick(r, [0x7a2a2e, 0x2a5a48, 0x3a4680, 0x8a6a2a, 0x5a2e6a, 0x2a5e6e, 0x9a4a1e, 0x26344e, 0x4a4a50, 0x7a6a4a, 0x3a2a2a, 0xa83a2a, 0x2e4a2a, 0x8a5a3a, 0x6a2040, 0x1e4a7a]), pick(r, [0x2a2a30, 0xc8bca8, 0x5a4030, 0x8a2a2a, 0x2a3a5a]), pick(r, [0xe0c040, 0xd04040, 0xe8e8e0, 0x40a0d0]), pick(r, [0xb0b0b8, 0xc8a050])],
    under: [pick(r, [0x2a3a5e, 0x3a3a40, 0x5a5040, 0x2a2a2e, 0x6a5a48, 0x4a2a2a, 0x2a3a2e]), pick(r, [0xe0e0d8, 0x8aa0c0, 0xc0a080, 0x6a3a5a, 0x3a6a5a, 0xd0b0b0, 0x404850]), pick(r, [0x2a1c12, 0x141416, 0x5a3a20, 0x6a2020, 0x2a2a3a]), 0xb8b8c0],
    hair: pick(r, r() < 0.15 ? HAIR.gray : r() < 0.4 ? HAIR.light : HAIR.dark),
  }),
};

// ----------------------------------------------------------------------------------------------- looks
const L = {};
L.thug = [
  { body: { b: 1.0 }, head: { jawW: 0.92, chin: 0.014, brow: 0.014 }, face: 'faceThugA', eyes: 'eyeA', hair: { kind: 'buzz' }, hat: { kind: 'cap', swatch: 'cap' },
    top: { kind: 'jacket', swatch: 'bomber', sleeveSwatch: 'bomberSleeve', len: 'waist', collar: 'band', collarSwatch: 'bomberCollar', gap: 0.18, gapY0: 1.5 }, shirt: { swatch: 'shirtPlain' },
    legs: { swatch: 'legJeans', pelvis: 'pelvisJeans' }, feet: { kind: 'combat', swatch: 'bootCombat' }, acc: [{ kind: 'belt' }] },
  { pal: { armor: [[0x8a1414, 0x14408a, 0x1e6a2a, 0x5a1e6a, 0xa86a0e, 0x2a2a2e, 0x0e6a6a]] }, body: { b: 1.04, belly: 0.1 }, head: { jawW: 0.95, chinW: 0.6, cheek: 0.008, nose: { w: 1.25, tip: 1.2 } }, face: 'faceThugC', eyes: 'eyeB', hair: { kind: 'buzz' }, hat: { kind: 'beanie', swatch: 'beanie' },
    top: { kind: 'hoodie', swatch: 'hoodie', sleeveSwatch: 'hoodieSleeve', len: 'hip', collar: 'hood', hoodSwatch: 'hoodieHood' }, shirt: { swatch: 'shirtPlain' },
    legs: { swatch: 'legTrack', pelvis: 'pelvisTrack' }, feet: { kind: 'sneaker', swatch: 'bootSneaker' }, acc: [] },
  { body: { b: 0.97 }, head: { jawW: 0.84, chinW: 0.45, gaunt: 0.004, nose: { len: 1.15, crook: 1 } }, face: 'faceThugB', eyes: 'eyeA', hair: { kind: 'mohawk', height: 0.1 }, armSkin: 'armTribal',
    top: { kind: 'jacket', swatch: 'leather', sleeveSwatch: 'leatherSleeve', len: 'waist', gap: 0.42, gapY0: 1.12, collar: 'shirt', collarSwatch: 'leatherCollar', collarGap: 0.5 }, shirt: { swatch: 'shirtPrint' },
    legs: { swatch: 'legJeans', pelvis: 'pelvisJeans' }, feet: { kind: 'combat', swatch: 'bootCombat' }, acc: [{ kind: 'belt', swatch: 'beltStud' }] },
  { body: { b: 1.08, armK: 1.12 }, head: { jawW: 0.96, chinW: 0.62, brow: 0.016, nose: { w: 1.3, crook: -1 } }, face: 'faceThugD', eyes: 'eyeB', hair: { kind: 'buzz' }, hat: { kind: 'bandana', swatch: 'bandana' }, armSkin: 'armSkulls',
    top: { kind: 'vest', swatch: 'vest', len: 'waist', sleeves: 'none', gap: 0.3, gapY0: 1.2, off: 0.02 }, shirt: { swatch: 'shirtDirty', sleeves: 'none' },
    legs: { swatch: 'legCargo', pelvis: 'pelvisCargo' }, feet: { kind: 'work', swatch: 'bootWork' }, acc: [{ kind: 'belt' }, { kind: 'wraps' }] },
  { pal: { armor: [[0xa01818, 0x1838a0, 0x187030, 0x6a1a8a, 0x101014], [0xe8e8e0, 0x101014, 0xe8c020], [0xe8e8e0, 0xf0c020, 0x20d0f0]], under: [[0xa01818, 0x1838a0, 0x101014, 0x187030]] }, body: { b: 0.95 }, head: { jawW: 0.86, chin: 0.01, nose: { len: 0.9 } }, face: 'faceThugA', eyes: 'eyeC', hair: { kind: 'cap', vol: 0.016, top: 0.2 },
    top: { kind: 'jacket', swatch: 'track', sleeveSwatch: 'trackSleeve', len: 'waist', collar: 'band', collarSwatch: 'trackCollar', gap: 0.3, gapY0: 1.35 }, shirt: { swatch: 'shirtStripe' },
    legs: { swatch: 'legJeans', pelvis: 'pelvisJeans' }, feet: { kind: 'sneaker', swatch: 'bootSneaker' }, acc: [] },
  { pal: { armor: [[0x8a1414, 0x14408a, 0x1e6a2a, 0x5a1e6a, 0xa86a0e, 0x5a5a60]] }, body: { b: 1.02 }, head: { jawW: 0.9, brow: 0.015 }, face: 'faceThugC', eyes: 'eyeA', hat: { kind: 'hood', swatch: 'hoodieHood' },
    top: { kind: 'hoodie', swatch: 'hoodie', sleeveSwatch: 'hoodieSleeve', len: 'hip', sleeves: 'rolled' }, shirt: { swatch: 'shirtPlain' }, armSkin: 'armFlames',
    legs: { swatch: 'legJeans', pelvis: 'pelvisJeans' }, feet: { kind: 'combat', swatch: 'bootCombat' }, acc: [] },
];
L.thug.push(
  { pal: { armor: [[0x8a1414, 0x14408a, 0x1e6a2a, 0x5a1e6a, 0xa86a0e, 0x2a2a2e]] }, body: { b: 1.06, belly: 0.08 }, head: { jawW: 0.96, chinW: 0.62, brow: 0.016, nose: { w: 1.2 } }, face: 'faceThugA', eyes: 'eyeB', hair: { kind: 'buzz' }, beard: { kind: 'full', t: 0.014 },
    top: { kind: 'hoodie', swatch: 'hoodie', sleeveSwatch: 'hoodieSleeve', len: 'hip', collar: 'hood', hoodSwatch: 'hoodieHood' }, shirt: { swatch: 'shirtPlain' },
    legs: { swatch: 'legCargo', pelvis: 'pelvisCargo' }, feet: { kind: 'work', swatch: 'bootWork' }, acc: [] },
  { pal: { armor: [[0x101014, 0xa01818, 0x1838a0, 0x187030], [0xe8e8e0, 0xf0c020]], under: [[0x101014, 0xa01818, 0x1838a0]] }, body: { b: 0.98 }, head: { jawW: 0.88, chin: 0.012 }, face: 'faceThugB', eyes: 'eyeA', hair: { kind: 'buzz' }, hat: { kind: 'bandana', swatch: 'bandana' },
    top: { kind: 'jacket', swatch: 'track', sleeveSwatch: 'trackSleeve', len: 'waist', collar: 'band', collarSwatch: 'trackCollar' }, shirt: { swatch: 'shirtPlain' },
    legs: { swatch: 'legTrack', pelvis: 'pelvisTrack' }, feet: { kind: 'sneaker', swatch: 'bootSneaker' }, acc: [] },
  { body: { b: 1.0 }, head: { jawW: 0.9, brow: 0.015, nose: { crook: 1.2 } }, face: 'faceThugC', eyes: 'eyeA', hair: { kind: 'buzz' }, hat: { kind: 'cap', swatch: 'cap', backwards: true }, armSkin: 'armSkulls',
    top: { kind: 'jacket', swatch: 'leather', sleeveSwatch: 'leatherSleeve', len: 'waist', sleeves: 'rolled', collar: 'shirt', collarSwatch: 'leatherCollar', collarGap: 0.42 }, shirt: { swatch: 'shirtPlain' },
    legs: { swatch: 'legJeans', pelvis: 'pelvisJeans' }, feet: { kind: 'combat', swatch: 'bootCombat' }, acc: [{ kind: 'belt', swatch: 'beltStud' }, { kind: 'wraps' }] },
  { body: { b: 1.03, armK: 1.06 }, head: { jawW: 0.94, chinW: 0.58 }, face: 'faceThugD', eyes: 'eyeA', hair: { kind: 'mohawk', height: 0.085 },
    top: { kind: 'jacket', swatch: 'bomber', sleeveSwatch: 'bomberSleeve', len: 'waist', collar: 'band', collarSwatch: 'bomberCollar', gap: 0.22, gapY0: 1.45 }, shirt: { swatch: 'shirtPrint' },
    legs: { swatch: 'legCargo', pelvis: 'pelvisCargo' }, feet: { kind: 'combat', swatch: 'bootCombat' }, acc: [{ kind: 'belt' }] },
);
L.gunman = [
  { body: { b: 1.0 }, head: { jawW: 0.9 }, face: 'faceGunA', eyes: 'eyeA', mask: { kind: 'balaclava', swatch: 'balaclava' }, hat: null, eyewear: { kind: 'goggles', glow: true },
    top: { kind: 'vest', straps: true, swatch: 'plateCarrier', len: 'waist', y0: 1.12, sleeves: 'none', off: 0.04 }, shirt: { swatch: 'shirtTac', sleeves: 'long', sleeveSwatch: 'sleeveTac' },
    legs: { swatch: 'legCamo', pelvis: 'pelvisCamo' }, feet: { kind: 'combat', swatch: 'bootCombat' }, hands: { glove: 'gloveTac' }, acc: [{ kind: 'belt' }, { kind: 'kneepads' }, { kind: 'pouches' }, { kind: 'holster' }] },
  { body: { b: 1.02 }, head: { jawW: 0.92, brow: 0.014 }, face: 'faceGunB', eyes: 'eyeA', hair: { kind: 'buzz' }, hat: { kind: 'cap', swatch: 'capTac' }, mask: { kind: 'respirator', swatch: 'respirator' },
    top: { kind: 'jacket', swatch: 'fieldCamo', sleeveSwatch: 'fieldCamoSleeve', len: 'hip', collar: 'shirt', collarSwatch: 'fieldCollar', collarGap: 0.42 }, shirt: { swatch: 'shirtTac' },
    legs: { swatch: 'legCamo', pelvis: 'pelvisCamo' }, feet: { kind: 'combat', swatch: 'bootCombat' }, hands: { glove: 'gloveTac' }, acc: [{ kind: 'belt' }, { kind: 'bandolier' }, { kind: 'holster' }] },
  { body: { b: 0.98 }, head: { jawW: 0.86 }, face: 'faceGunA', eyes: 'eyeB', hair: { kind: 'buzz' }, hat: { kind: 'beanie', swatch: 'beanie' }, eyewear: { kind: 'goggles', glow: true, overHat: false }, mask: { kind: 'bandanaFace', swatch: 'bandana' },
    top: { kind: 'vest', straps: true, swatch: 'plateCarrier', len: 'waist', y0: 1.12, sleeves: 'none', off: 0.04 }, shirt: { swatch: 'shirtTac', sleeves: 'rolled', sleeveSwatch: 'sleeveTac' }, armSkin: 'armHairy',
    legs: { swatch: 'legCargo', pelvis: 'pelvisCargo' }, feet: { kind: 'combat', swatch: 'bootCombat' }, hands: { glove: 'gloveTac', fingerless: true }, acc: [{ kind: 'belt' }, { kind: 'pouches' }, { kind: 'holster' }] },
  { body: { b: 1.05 }, head: { jawW: 0.95, chin: 0.016 }, face: 'faceGunB', eyes: 'eyeA', hair: { kind: 'buzz' }, eyewear: { kind: 'shades', glow: false },
    top: { kind: 'jacket', swatch: 'fieldJacket', sleeveSwatch: 'fieldSleeve', len: 'hip', collar: 'shirt', collarSwatch: 'fieldCollar', collarGap: 0.42, gap: 0.25, gapY0: 1.45 }, shirt: { swatch: 'shirtTac' },
    legs: { swatch: 'legPadded', pelvis: 'pelvisCargo' }, feet: { kind: 'combat', swatch: 'bootCombat' }, hands: { glove: 'gloveTac' }, acc: [{ kind: 'belt' }, { kind: 'kneepads' }, { kind: 'bandolier' }, { kind: 'holster' }] },
];
L.gunman.push(
  { body: { b: 1.02 }, head: { jawW: 0.92 }, face: 'faceGunA', eyes: 'eyeA', mask: { kind: 'balaclava', swatch: 'balaclava' }, hat: { kind: 'cap', swatch: 'capTac' }, eyewear: { kind: 'goggles', glow: true },
    top: { kind: 'jacket', swatch: 'fieldCamo', sleeveSwatch: 'fieldCamoSleeve', len: 'hip', collar: 'shirt', collarSwatch: 'fieldCollar', collarGap: 0.42 }, shirt: { swatch: 'shirtTac' },
    legs: { swatch: 'legCargo', pelvis: 'pelvisCargo' }, feet: { kind: 'combat', swatch: 'bootCombat' }, hands: { glove: 'gloveTac' }, acc: [{ kind: 'belt' }, { kind: 'holster' }] },
  { body: { b: 1.04 }, head: { jawW: 0.94, brow: 0.015 }, face: 'faceGunB', eyes: 'eyeB', hair: { kind: 'buzz' }, hat: { kind: 'beanie', swatch: 'beanie' }, mask: { kind: 'respirator', swatch: 'respirator' },
    top: { kind: 'vest', straps: true, swatch: 'plateCarrier', len: 'waist', y0: 1.12, sleeves: 'none', off: 0.04 }, shirt: { swatch: 'shirtTac', sleeves: 'long', sleeveSwatch: 'sleeveTac' },
    legs: { swatch: 'legPadded', pelvis: 'pelvisCargo' }, feet: { kind: 'combat', swatch: 'bootCombat' }, hands: { glove: 'gloveTac' }, acc: [{ kind: 'belt' }, { kind: 'kneepads' }, { kind: 'pouches' }, { kind: 'bandolier' }] },
);
L.brute = [
  { backGun: 'sawnoff', body: { b: 1.3, W: 0.53, armK: 1.62, legK: 1.32, neckK: 1.55, chest: 1.12 }, head: { jawW: 1.0, chinW: 0.7, brow: 0.02, cranium: 0.95, nose: { w: 1.4, crook: 1.5 } }, face: 'faceBrute', eyes: 'eyeA', hat: { kind: 'helmetRiot', swatch: 'helmetRiot' },
    top: { kind: 'suit', swatch: 'riotSuit', sleeveSwatch: 'riotSleeve', len: 'hip', off: 0.018 }, shirt: { swatch: 'shirtTac' },
    legs: { swatch: 'legPadded', pelvis: 'pelvisArmor' }, feet: { kind: 'combat', swatch: 'bootCombat', size: 1.1 }, hands: { glove: 'gloveTac', size: 1.35 }, acc: [{ kind: 'belt' }, { kind: 'chestplate' }, { kind: 'pauldrons' }, { kind: 'gauntlets' }, { kind: 'greaves' }, { kind: 'shieldArm' }] },
  { backGun: 'sawnoff', body: { b: 1.34, W: 0.55, armK: 1.66, legK: 1.34, neckK: 1.6, belly: 0.12, chest: 1.1 }, head: { jawW: 1.02, chinW: 0.74, brow: 0.022, nose: { w: 1.5 } }, face: 'faceBrute', eyes: 'eyeB', hair: { kind: 'bald' }, armSkin: 'armTribal',
    top: { kind: 'suit', swatch: 'riotSuit', sleeveSwatch: 'riotSleeve', len: 'hip', sleeves: 'none', off: 0.018 }, shirt: { swatch: 'shirtTac', sleeves: 'none' },
    legs: { swatch: 'legPadded', pelvis: 'pelvisArmor' }, feet: { kind: 'combat', swatch: 'bootCombat', size: 1.1 }, hands: { glove: 'gloveTac', size: 1.4 }, acc: [{ kind: 'belt' }, { kind: 'chestplate' }, { kind: 'pauldrons' }, { kind: 'gauntlets' }, { kind: 'greaves' }] },
  { body: { b: 1.28, W: 0.52, armK: 1.6, legK: 1.3, neckK: 1.5, chest: 1.12 }, head: { jawW: 0.98, chinW: 0.7, brow: 0.02 }, face: 'faceBrute', eyes: 'eyeA', hat: { kind: 'helmetRiot', swatch: 'helmetRiot' },
    top: { kind: 'suit', swatch: 'riotSuit', sleeveSwatch: 'riotSleeve', len: 'hip', off: 0.018 }, shirt: { swatch: 'shirtTac' },
    legs: { swatch: 'legPadded', pelvis: 'pelvisArmor' }, feet: { kind: 'combat', swatch: 'bootCombat', size: 1.1 }, hands: { glove: 'gloveTac', size: 1.35 }, acc: [{ kind: 'belt' }, { kind: 'chestplate' }, { kind: 'pauldrons', big: true }, { kind: 'gauntlets' }, { kind: 'greaves' }, { kind: 'shieldArm' }] },
];
L.brute.push(
  { body: { b: 1.3, W: 0.54, armK: 1.64, legK: 1.32, neckK: 1.55, chest: 1.12 }, head: { jawW: 1.0, chinW: 0.72, brow: 0.021 }, face: 'faceBrute', eyes: 'eyeA', hat: { kind: 'helmetRiot', swatch: 'helmetRiot' }, armSkin: 'armSkulls',
    top: { kind: 'suit', swatch: 'riotSuit', sleeveSwatch: 'riotSleeve', len: 'hip', sleeves: 'none', off: 0.018 }, shirt: { swatch: 'shirtTac', sleeves: 'none' },
    legs: { swatch: 'legPadded', pelvis: 'pelvisArmor' }, feet: { kind: 'combat', swatch: 'bootCombat', size: 1.1 }, hands: { glove: 'gloveTac', size: 1.4 }, acc: [{ kind: 'belt' }, { kind: 'chestplate' }, { kind: 'pauldrons', big: true }, { kind: 'gauntlets' }, { kind: 'greaves' }] },
);
L.junkie = [
  { body: { b: 0.84, gaunt: 1, hunch: 0.8, armK: 0.74, legK: 0.78, neckK: 0.8 }, head: { gaunt: 0.012, cheek: 0.01, jawW: 0.82, chinW: 0.45, sock: 0.016, nose: { len: 1.1 } }, face: 'faceJunkA', eyes: 'eyeJunk', glowEyes: true, asym: 0.03, hair: { kind: 'spiky', len: 0.08, count: 22 },
    top: { kind: 'hoodie', swatch: 'ragHoodie', sleeveSwatch: 'ragSleeve', len: 'hip', sleeves: 'rolled', collar: 'hood', hoodSwatch: 'ragHood' }, shirt: { swatch: 'shirtDirty' }, armSkin: 'armTracks',
    legs: { swatch: 'legRipped', pelvis: 'pelvisJeans', k: 0.92 }, feet: { kind: 'sneaker', swatch: 'bootSneaker' }, acc: [{ kind: 'veins' }] },
  { body: { b: 0.82, gaunt: 1, hunch: 1.0, armK: 0.72, legK: 0.76, neckK: 0.78 }, head: { gaunt: 0.014, cheek: 0.011, jawW: 0.8, chinW: 0.42, sock: 0.017 }, face: 'faceJunkB', eyes: 'eyeJunk', glowEyes: true, asym: 0.035, hair: { kind: 'mohawk', height: 0.07, spikes: 0.9 },
    top: { kind: 'tank', tank: true, swatch: 'ragTank', len: 'waist', sleeves: 'none', off: 0.008 }, shirt: { swatch: 'shirtDirty', sleeves: 'none' }, armSkin: 'armTracks',
    legs: { swatch: 'legRipped', pelvis: 'pelvisJeans', k: 0.9 }, feet: { kind: 'sneaker', swatch: 'bootSneaker' }, acc: [{ kind: 'belt' }, { kind: 'veins' }] },
  { body: { b: 0.86, gaunt: 0.8, hunch: 0.7, armK: 0.76, legK: 0.8 }, head: { gaunt: 0.01, jawW: 0.84, sock: 0.015, nose: { crook: 1 } }, face: 'faceJunkA', eyes: 'eyeJunk', glowEyes: true, asym: 0.025, hair: { kind: 'long', len: 0.16 },
    top: { kind: 'jacket', swatch: 'ragJacket', sleeveSwatch: 'ragJacketSleeve', len: 'waist', gap: 0.5, gapY0: 1.1, collar: 'band', collarSwatch: 'ragJacketSleeve' }, shirt: { swatch: 'shirtDirty' },
    legs: { swatch: 'legTrack', pelvis: 'pelvisTrack', k: 0.9 }, feet: { kind: 'sneaker', swatch: 'bootSneaker' }, acc: [{ kind: 'veins' }] },
];
L.junkie.push(
  { body: { b: 0.83, gaunt: 1, hunch: 0.9, armK: 0.73, legK: 0.77, neckK: 0.8 }, head: { gaunt: 0.013, cheek: 0.01, jawW: 0.8, chinW: 0.44, sock: 0.016 }, face: 'faceJunkB', eyes: 'eyeJunk', glowEyes: true, asym: 0.03, hat: { kind: 'hood', swatch: 'ragHood' },
    top: { kind: 'hoodie', swatch: 'ragHoodie', sleeveSwatch: 'ragSleeve', len: 'hip', sleeves: 'rolled' }, shirt: { swatch: 'shirtDirty' }, armSkin: 'armTracks',
    legs: { swatch: 'legRipped', pelvis: 'pelvisJeans', k: 0.9 }, feet: { kind: 'sneaker', swatch: 'bootSneaker' }, acc: [{ kind: 'veins' }] },
  { body: { b: 0.85, gaunt: 0.9, hunch: 0.8, armK: 0.74, legK: 0.78 }, head: { gaunt: 0.011, jawW: 0.83, sock: 0.015, nose: { len: 1.15, crook: -1 } }, face: 'faceJunkA', eyes: 'eyeJunk', glowEyes: true, asym: 0.03, hair: { kind: 'spiky', len: 0.06, count: 26, seed: 19 },
    top: { kind: 'jacket', swatch: 'ragJacket', sleeveSwatch: 'ragJacketSleeve', len: 'waist', gap: 0.55, gapY0: 1.06, sleeves: 'rolled', collar: 'band', collarSwatch: 'ragJacketSleeve' }, shirt: { swatch: 'shirtDirty' }, armSkin: 'armTracks',
    legs: { swatch: 'legRipped', pelvis: 'pelvisJeans', k: 0.9 }, feet: { kind: 'sneaker', swatch: 'bootSneaker' }, acc: [{ kind: 'belt' }, { kind: 'veins' }] },
);
L.biker = [
  { body: { b: 1.04 }, head: { jawW: 0.9 }, face: 'faceThugA', eyes: 'eyeA', hat: { kind: 'helmetFull', swatch: 'helmet', visor: 'visorTint' },
    top: { kind: 'jacket', swatch: 'leathers', sleeveSwatch: 'leathersSleeve', len: 'waist', collar: 'band', collarSwatch: 'leathersCollar' }, shirt: { swatch: 'shirtPlain' },
    legs: { swatch: 'legLeather', pelvis: 'pelvisLeather', cuff: 'tucked' }, feet: { kind: 'biker', swatch: 'bootBiker' }, hands: { glove: 'gloveLeather', cuff: true }, acc: [{ kind: 'belt' }] },
  { body: { b: 1.08 }, head: { jawW: 0.92 }, face: 'faceThugC', eyes: 'eyeA', hat: { kind: 'helmetFull', swatch: 'helmetFlames', visor: 'visorTint' },
    top: { kind: 'jacket', swatch: 'leathers', sleeveSwatch: 'leathersSleeve', len: 'waist', collar: 'band', collarSwatch: 'leathersCollar' }, shirt: { swatch: 'shirtPlain' },
    legs: { swatch: 'legLeather', pelvis: 'pelvisLeather' }, feet: { kind: 'biker', swatch: 'bootBiker' }, hands: { glove: 'gloveLeather', cuff: true }, acc: [{ kind: 'belt', swatch: 'beltStud' }, { kind: 'kneepads' }] },
];
L.biker.push(
  { pal: { armor: [[0xe8e8e8, 0x14141a], [0xc01020, 0x1838c0, 0x101014]] }, body: { b: 1.06 }, head: { jawW: 0.9 }, face: 'faceThugB', eyes: 'eyeA', hat: { kind: 'helmetFull', swatch: 'helmetFlames', visor: 'visorTint' },
    top: { kind: 'jacket', swatch: 'leathers', sleeveSwatch: 'leathersSleeve', len: 'waist', collar: 'band', collarSwatch: 'leathersCollar' }, shirt: { swatch: 'shirtPlain' },
    legs: { swatch: 'legLeather', pelvis: 'pelvisLeather' }, feet: { kind: 'biker', swatch: 'bootBiker' }, hands: { glove: 'gloveLeather', cuff: true }, acc: [{ kind: 'belt' }, { kind: 'kneepads' }] },
);
L.boss = [
  { backGun: 'smg', body: { b: 1.42, W: 0.6, armK: 1.5, legK: 1.32, neckK: 1.5, belly: 0.24, chest: 1.08 }, head: { jawW: 1.0, chinW: 0.68, jowl: 0.01, brow: 0.018, cranium: 1.02, nose: { w: 1.3, tip: 1.2 } }, face: 'faceBossA', eyes: 'eyeBoss', hair: { kind: 'bald' },
    top: { kind: 'coat', swatch: 'coat', sleeveSwatch: 'coatSleeve', len: 'coat', gap: 0.42, gapY0: 0.86, gapY1: 1.24, collar: 'fur', collarSwatch: 'fur', off: 0.03 }, shirt: { swatch: 'shirtDress' },
    legs: { swatch: 'legSlacks', pelvis: 'pelvisSlacks' }, feet: { kind: 'dress', swatch: 'shoeDress', size: 1.06 }, hands: { size: 1.25 }, acc: [{ kind: 'belt' }, { kind: 'coatTails', open: true }, { kind: 'chain' }, { kind: 'rings' }, { kind: 'cigar' }] },
  { body: { b: 1.45, W: 0.62, armK: 1.55, legK: 1.35, neckK: 1.55, belly: 0.2, chest: 1.1 }, head: { jawW: 1.02, chinW: 0.72, jowl: 0.012, brow: 0.017, nose: { w: 1.4, crook: 1 } }, face: 'faceBossB', eyes: 'eyeBoss', hair: { kind: 'cap', vol: 0.012, top: 0.1, slick: true }, eyewear: { kind: 'shades' },
    top: { kind: 'coat', swatch: 'coat', sleeveSwatch: 'coatSleeve', len: 'coat', gap: 0.46, gapY0: 0.86, gapY1: 1.28, collar: 'fur', collarSwatch: 'fur', off: 0.03 }, shirt: { swatch: 'shirtDress' },
    legs: { swatch: 'legSlacks', pelvis: 'pelvisSlacks' }, feet: { kind: 'dress', swatch: 'shoeDress', size: 1.06 }, hands: { size: 1.25 }, acc: [{ kind: 'belt' }, { kind: 'coatTails', open: true }, { kind: 'chain' }, { kind: 'rings' }, { kind: 'pauldrons', boss: true }] },
];
L.boss.push(
  { body: { b: 1.44, W: 0.61, armK: 1.52, legK: 1.33, neckK: 1.55, belly: 0.28, chest: 1.06 }, head: { jawW: 1.02, chinW: 0.7, jowl: 0.012, brow: 0.018, nose: { w: 1.35, crook: 1.3 } }, face: 'faceBossA', eyes: 'eyeBoss', hair: { kind: 'bald' }, beard: { kind: 'full', t: 0.016 },
    top: { kind: 'coat', swatch: 'coat', sleeveSwatch: 'coatSleeve', len: 'coat', gap: 0.44, gapY0: 0.86, gapY1: 1.26, collar: 'fur', collarSwatch: 'fur', off: 0.03 }, shirt: { swatch: 'shirtDress' },
    legs: { swatch: 'legSlacks', pelvis: 'pelvisSlacks' }, feet: { kind: 'dress', swatch: 'shoeDress', size: 1.06 }, hands: { size: 1.25 }, acc: [{ kind: 'belt' }, { kind: 'coatTails', open: true }, { kind: 'chain' }, { kind: 'rings' }, { kind: 'cigar' }, { kind: 'pauldrons', boss: true }] },
);
L.civ = [
  { sex: 'm', body: { b: 0.95, armK: 0.86 }, face: 'faceCivM', eyes: 'eyeC', hair: { kind: 'cap', vol: 0.02, top: 0.4, quiff: 0.5 }, top: { kind: 'coat', swatch: 'coatCiv', sleeveSwatch: 'coatCivSleeve', len: 'thigh', collar: 'shirt', collarSwatch: 'coatCivCollar', gap: 0.3, gapY0: 1.45 }, shirt: { swatch: 'shirtDress' }, legs: { swatch: 'legSlacks', pelvis: 'pelvisSlacks' }, feet: { kind: 'dress', swatch: 'shoeDress' }, acc: [{ kind: 'scarf' }, { kind: 'coatTails', swatch: 'coatCivSleeve', len: 0.46 }] },
  { sex: 'm', body: { b: 1.0, belly: 0.15, armK: 0.9 }, face: 'faceCivM2', eyes: 'eyeC', hair: { kind: 'cap', vol: 0.014, top: 0.2 }, hat: { kind: 'cap', swatch: 'cap' }, top: { kind: 'jacket', swatch: 'parka', sleeveSwatch: 'parkaSleeve', len: 'hip', collar: 'hood', hoodSwatch: 'parkaHood' }, shirt: { swatch: 'shirtPlaid' }, legs: { swatch: 'legJeans', pelvis: 'pelvisJeans' }, feet: { kind: 'work', swatch: 'bootWork' }, acc: [{ kind: 'belt' }] },
  { sex: 'f', body: { b: 0.86, fem: 1, armK: 0.74 }, face: 'faceCivF', eyes: 'eyeFem', head: { jawW: 0.82, chinW: 0.42, brow: 0.004, chin: 0.006, rx: 0.112, nose: { w: 0.8, len: 0.85, tip: 0.85 } }, hair: { kind: 'long', len: 0.24 }, top: { kind: 'coat', swatch: 'raincoat', sleeveSwatch: 'raincoatSleeve', len: 'thigh', collar: 'shirt', collarSwatch: 'coatCivCollar', gap: 0.25, gapY0: 1.5 }, shirt: { swatch: 'shirtKnit' }, legs: { swatch: 'legSlacks', pelvis: 'pelvisSlacks', k: 0.9 }, feet: { kind: 'heel', swatch: 'shoeDress' }, acc: [{ kind: 'bag' }, { kind: 'coatTails', swatch: 'raincoatSleeve', len: 0.5 }] },
  { sex: 'f', body: { b: 0.84, fem: 1, armK: 0.72 }, face: 'faceCivF2', eyes: 'eyeFem', head: { jawW: 0.8, chinW: 0.42, brow: 0.003, rx: 0.11, nose: { w: 0.8, len: 0.8 } }, hair: { kind: 'pony' }, top: { kind: 'jacket', swatch: 'sweatshirt', sleeveSwatch: 'sweatshirtSleeve', len: 'waist' }, shirt: { swatch: 'shirtPlain' }, legs: { swatch: 'legJeans', pelvis: 'pelvisJeans', skirt: { swatch: 'skirtPlaid', len: 0.26, flare: 0.4 }, bare: { on: 'thigh', d: 0.16 }, k: 0.88 }, feet: { kind: 'sneaker', swatch: 'bootSneaker' }, acc: [] },
  { sex: 'm', body: { b: 0.92, hunch: 0.5, belly: 0.05, armK: 0.82 }, face: 'faceCivOld', eyes: 'eyeOld', head: { jowl: 0.006, gaunt: 0.004, nose: { len: 1.15, tip: 1.15 }, ear: 1.15 }, hair: { kind: 'buzz', front: 0.75 }, hat: { kind: 'fedora', swatch: 'fedora' }, eyewear: { kind: 'glasses' }, old: true, top: { kind: 'cardigan', swatch: 'cardigan', sleeveSwatch: 'cardiganSleeve', len: 'hip', gap: 0.28, gapY0: 1.4 }, shirt: { swatch: 'shirtDress', collar: 'shirt' }, legs: { swatch: 'legSlacks', pelvis: 'pelvisSlacks' }, feet: { kind: 'dress', swatch: 'shoeDress' }, acc: [{ kind: 'belt' }] },
  { sex: 'm', body: { b: 0.98, armK: 0.88 }, face: 'faceCivM', eyes: 'eyeC', hair: { kind: 'afro', vol: 0.055 }, top: { kind: 'jacket', swatch: 'blazer', sleeveSwatch: 'blazerSleeve', len: 'hip', collar: 'shirt', collarSwatch: 'blazerCollar', gap: 0.42, gapY0: 1.2 }, shirt: { swatch: 'shirtPrint' }, legs: { swatch: 'legJeans', pelvis: 'pelvisJeans' }, feet: { kind: 'sneaker', swatch: 'bootSneaker' }, acc: [] },
  { sex: 'f', body: { b: 0.88, fem: 1, belly: 0.06, armK: 0.75 }, face: 'faceCivF', eyes: 'eyeFem', head: { jawW: 0.84, chinW: 0.45, brow: 0.004, rx: 0.112, nose: { w: 0.85 } }, hair: { kind: 'bun' }, top: { kind: 'jacket', swatch: 'blazer', sleeveSwatch: 'blazerSleeve', len: 'hip', collar: 'shirt', collarSwatch: 'blazerCollar', gap: 0.38, gapY0: 1.25 }, shirt: { swatch: 'shirtDress' }, legs: { swatch: 'legSlacks', pelvis: 'pelvisSlacks', skirt: { swatch: 'skirtPlain', len: 0.3, flare: 0.25 }, bare: { on: 'thigh', d: 0.2 }, k: 0.9 }, feet: { kind: 'heel', swatch: 'shoeDress' }, acc: [{ kind: 'bag' }] },
  { sex: 'm', body: { b: 0.9, armK: 0.84 }, face: 'faceCivM2', eyes: 'eyeC', hair: { kind: 'dreads' }, top: { kind: 'hoodie', swatch: 'sweatshirt', sleeveSwatch: 'sweatshirtSleeve', len: 'hip' }, shirt: { swatch: 'shirtPlain' }, legs: { swatch: 'legCargo', pelvis: 'pelvisCargo' }, feet: { kind: 'sneaker', swatch: 'bootSneaker' }, acc: [] },
  { sex: 'f', body: { b: 0.85, fem: 1, hunch: 0.4, armK: 0.72 }, face: 'faceCivOld', eyes: 'eyeOld', head: { jawW: 0.84, chinW: 0.46, jowl: 0.006, rx: 0.112 }, hair: { kind: 'bun' }, eyewear: { kind: 'glasses' }, old: true, top: { kind: 'coat', swatch: 'coatCiv', sleeveSwatch: 'coatCivSleeve', len: 'thigh', collar: 'shirt', collarSwatch: 'coatCivCollar' }, shirt: { swatch: 'shirtKnit' }, legs: { swatch: 'legSlacks', pelvis: 'pelvisSlacks', k: 0.92 }, feet: { kind: 'flat', swatch: 'shoeDress' }, acc: [{ kind: 'scarf' }, { kind: 'bag' }, { kind: 'coatTails', swatch: 'coatCivSleeve', len: 0.52 }] },
  { sex: 'm', body: { b: 1.05, belly: 0.25, armK: 0.95 }, face: 'faceCivM', eyes: 'eyeB', head: { jowl: 0.01, jawW: 0.98 }, hair: { kind: 'cap', vol: 0.01, top: 0.1, front: 0.75 }, top: { kind: 'none' }, shirt: { swatch: 'shirtPlaid', sleeves: 'rolled', sleeveSwatch: 'sleeveShirt', collar: 'shirt', collarAtlas: 'under' }, armSkin: 'armHairy', legs: { swatch: 'legJeans', pelvis: 'pelvisJeans' }, feet: { kind: 'work', swatch: 'bootWork' }, acc: [{ kind: 'belt' }] },
  { sex: 'k', body: { b: 0.82, armK: 0.78 }, kid: true, face: 'faceCivF2', eyes: 'eyeC', head: { jawW: 0.8, chinW: 0.45, brow: 0.002, chin: 0.004, nose: { len: 0.75, w: 0.85, tip: 0.85 } }, hair: { kind: 'cap', vol: 0.024, top: 0.5 }, hat: { kind: 'cap', swatch: 'cap', backwards: true }, top: { kind: 'hoodie', swatch: 'sweatshirt', sleeveSwatch: 'sweatshirtSleeve', len: 'hip' }, shirt: { swatch: 'shirtPrint' }, legs: { swatch: 'legJeans', pelvis: 'pelvisJeans' }, feet: { kind: 'sneaker', swatch: 'bootSneaker' }, acc: [] },
  { sex: 'f', body: { b: 0.86, fem: 1, armK: 0.74 }, face: 'faceCivF2', eyes: 'eyeFem', head: { jawW: 0.82, chinW: 0.44, rx: 0.11 }, hair: { kind: 'afro', vol: 0.05 }, top: { kind: 'jacket', swatch: 'parka', sleeveSwatch: 'parkaSleeve', len: 'hip', collar: 'hood', hoodSwatch: 'parkaHood', gap: 0.3, gapY0: 1.35 }, shirt: { swatch: 'shirtStripe' }, legs: { swatch: 'legJeans', pelvis: 'pelvisJeans', k: 0.9 }, feet: { kind: 'combat', swatch: 'bootCombat' }, acc: [{ kind: 'scarf' }] },
];
export const LOOKS = L;
export function lookCount(style) { return (L[style] || L.thug).length; }
export function lookSpec(style, i) { const arr = L[style] || L.thug; return arr[((i % arr.length) + arr.length) % arr.length]; }
export { VY };
