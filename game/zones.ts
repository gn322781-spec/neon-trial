export type PlatformSpec = { x: number; y: number; width: number; height?: number };
export type PickupSpec = { x: number; y: number; id: string };
export type HazardSpec = { x: number; y: number; width: number; height: number; kind: "spike" | "saw" };
export type EnemyKind = "goblin" | "mushroom" | "skeleton" | "flying-eye";
export type EnemySpec = { x: number; y: number; id: string; kind: EnemyKind; minX?: number; maxX?: number };
export type ZoneSpec = {
  name: string;
  start: number;
  end: number;
  platforms: PlatformSpec[];
  crystals: PickupSpec[];
  hazards: HazardSpec[];
  enemies: EnemySpec[];
  checkpoint: number;
};

// Hand-built geometry keeps each run learnable and consistent.
export const ZONES: ZoneSpec[] = [
  {
    name: "01 / BOOT SEQUENCE", start: 0, end: 1_000, checkpoint: 760,
    platforms: [
      { x: 180, y: 510, width: 360 }, { x: 660, y: 510, width: 330 },
      { x: 410, y: 420, width: 150 }, { x: 610, y: 350, width: 130 }, { x: 850, y: 420, width: 190 },
    ],
    crystals: [{ x: 300, y: 445, id: "c1" }, { x: 460, y: 370, id: "c2" }, { x: 660, y: 300, id: "c3" }, { x: 900, y: 370, id: "c4" }],
    hazards: [{ x: 560, y: 465, width: 42, height: 30, kind: "spike" }],
    enemies: [{ x: 720, y: 480, minX: 520, maxX: 805, kind: "goblin", id: "goblin-boot" }],
  },
  {
    name: "02 / EDGE CONTROL", start: 1_000, end: 2_000, checkpoint: 1_650,
    platforms: [
      { x: 1_155, y: 510, width: 240 }, { x: 1_470, y: 425, width: 118 }, { x: 1_665, y: 335, width: 110 },
      { x: 1_840, y: 435, width: 230 }, { x: 1_470, y: 510, width: 100 }, { x: 1_675, y: 510, width: 90 },
    ],
    crystals: [{ x: 1_150, y: 445, id: "c5" }, { x: 1_470, y: 375, id: "c6" }, { x: 1_670, y: 285, id: "c7" }, { x: 1_930, y: 375, id: "c8" }],
    hazards: [{ x: 1_390, y: 465, width: 48, height: 30, kind: "spike" }, { x: 1_790, y: 465, width: 42, height: 30, kind: "spike" }],
    enemies: [
      { x: 1_180, y: 480, minX: 1_060, maxX: 1_255, kind: "mushroom", id: "mushroom-edge" },
      { x: 1_660, y: 255, minX: 1_560, maxX: 1_780, kind: "flying-eye", id: "eye-edge" },
    ],
  },
  {
    name: "03 / PHASE SHIFT", start: 2_000, end: 3_000, checkpoint: 2_680,
    platforms: [
      { x: 2_140, y: 510, width: 230 }, { x: 2_490, y: 410, width: 120 }, { x: 2_730, y: 320, width: 120 },
      { x: 2_960, y: 425, width: 190 }, { x: 2_400, y: 510, width: 100 }, { x: 2_670, y: 510, width: 90 },
    ],
    crystals: [{ x: 2_110, y: 450, id: "c9" }, { x: 2_490, y: 360, id: "c10" }, { x: 2_740, y: 270, id: "c11" }, { x: 2_990, y: 365, id: "c12" }],
    hazards: [
      { x: 2_380, y: 490, width: 54, height: 36, kind: "saw" },
      { x: 2_840, y: 490, width: 54, height: 36, kind: "saw" },
    ], enemies: [
      { x: 2_220, y: 480, minX: 2_035, maxX: 2_350, kind: "skeleton", id: "skeleton-phase" },
      { x: 2_810, y: 245, minX: 2_680, maxX: 2_920, kind: "flying-eye", id: "eye-phase" },
    ],
  },
  {
    name: "04 / LAST SIGNAL", start: 3_000, end: 4_200, checkpoint: 3_250,
    platforms: [
      { x: 3_145, y: 510, width: 250 }, { x: 3_460, y: 415, width: 150 }, { x: 3_700, y: 330, width: 145 },
      { x: 3_940, y: 430, width: 250 }, { x: 4_140, y: 510, width: 160 }, { x: 3_405, y: 510, width: 80 },
    ],
    crystals: [{ x: 3_120, y: 450, id: "c13" }, { x: 3_470, y: 365, id: "c14" }, { x: 3_710, y: 280, id: "c15" }, { x: 4_020, y: 370, id: "c16" }],
    hazards: [{ x: 3_610, y: 490, width: 52, height: 36, kind: "saw" }, { x: 3_865, y: 465, width: 44, height: 30, kind: "spike" }],
    enemies: [
      { x: 3_260, y: 480, minX: 3_035, maxX: 3_375, kind: "goblin", id: "goblin-signal" },
      { x: 3_715, y: 300, minX: 3_635, maxX: 3_765, kind: "mushroom", id: "mushroom-signal" },
      { x: 4_100, y: 480, minX: 4_075, maxX: 4_205, kind: "skeleton", id: "skeleton-signal" },
    ],
  },
];

