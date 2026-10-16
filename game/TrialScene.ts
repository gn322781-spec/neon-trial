import * as Phaser from "phaser";
import { AudioFeedback } from "@/game/audio";
import { Controls } from "@/game/controls";
import { PHYSICS, jumpVelocityAfterRelease } from "@/game/physics";
import { awardScore, createScoreState, GAME_VERSION, STARTING_LIVES, SURVIVAL_SCORE_PER_SECOND, type ScoreEvent, type ScoreState } from "@/game/rules";
import { ZONES, type EnemyKind, type EnemySpec } from "@/game/zones";

export type TrialHud = { score: number; zone: number; deaths: number; lives: number; distance: number; dashReady: boolean; checkpoint: number };
export type AttemptEvent = { event: ScoreEvent; key: string; at_ms: number; x: number };
export type TrialResult = TrialHud & { completed: true; elapsedMs: number; gameVersion: string; events: AttemptEvent[]; zonesCompleted: number };

type MobileSnapshot = ReturnType<Controls["snapshot"]>;
type DamageHazard = { shape: Phaser.GameObjects.Rectangle; ring?: Phaser.GameObjects.Arc; baseX: number; moving: boolean; phase: number; kind: string; period: number; amplitude: number };
type EnemyState = "patrol" | "approach" | "attack" | "hit" | "dying";
type EnemyUnit = {
  id: string;
  kind: EnemyKind;
  sprite: Phaser.GameObjects.Sprite;
  hitbox: Phaser.GameObjects.Rectangle;
  homeX: number;
  baseY: number;
  minX: number;
  maxX: number;
  direction: number;
  state: EnemyState;
  stateUntil: number;
  impactAt: number;
  attackHit: boolean;
  nextAttackAt: number;
  health: number;
};
type GeneratedSegment = {
  start: number;
  end: number;
  renderEnd: number;
  checkpointX: number;
  checkpoint?: Phaser.GameObjects.Triangle;
  platforms: Phaser.GameObjects.Rectangle[];
  pickups: Phaser.GameObjects.Image[];
  objects: Phaser.GameObjects.GameObject[];
  hazards: DamageHazard[];
  enemies: EnemyUnit[];
};
type BackgroundLayer = { sprite: Phaser.GameObjects.TileSprite; parallax: number };
type Keys = {
  left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key; jump: Phaser.Input.Keyboard.Key;
  dash: Phaser.Input.Keyboard.Key; attack: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key; w: Phaser.Input.Keyboard.Key; z: Phaser.Input.Keyboard.Key;
  up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; s: Phaser.Input.Keyboard.Key; c: Phaser.Input.Keyboard.Key;
};

const WORLD_WIDTH = 4_200;
const SEGMENT_LENGTH = 1_000;
const CHUNK_AHEAD = 2;
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 540;
const PLAYER_ART_SCALE = 0.22;
const PLAYER_BODY_WIDTH = 40;
const PLAYER_BODY_HEIGHT = 66;
const PLAYER_START_X = 75;
const GROUND_TOP = 480;
const PLAYER_START_Y = GROUND_TOP - PLAYER_BODY_HEIGHT / 2;
const PLAYER_ART_FOOT_OFFSET = PLAYER_BODY_HEIGHT / 2;
const PICKUP_TEXTURE = "cigarette-pack";
const BACKGROUND_LAYERS = [
  { key: "cave-color", path: "/cave/7.png", parallax: 0.005, depth: -32, alpha: 1 },
  { key: "cave-backdrop", path: "/cave/0.png", parallax: 0.012, depth: -30, alpha: 1 },
  { key: "cave-foreground", path: "/cave/6.png", parallax: 0.08, depth: -28, alpha: 0.78 },
  { key: "cave-overhangs", path: "/cave/5.png", parallax: 0.13, depth: -26, alpha: 0.74 },
  { key: "cave-pillars", path: "/cave/4.png", parallax: 0.18, depth: -24, alpha: 0.72 },
  { key: "cave-columns", path: "/cave/3.png", parallax: 0.23, depth: -22, alpha: 0.72 },
  { key: "cave-rubble", path: "/cave/2.png", parallax: 0.28, depth: -20, alpha: 0.88 },
  { key: "cave-edges", path: "/cave/1.png", parallax: 0.34, depth: -18, alpha: 0.9 },
] as const;
const ISLAND_PLATFORMS = [
  { key: "space-island-1", surface: 0.46 },
  { key: "space-island-2", surface: 0.012 },
  { key: "space-island-3", surface: 0.288 },
  { key: "space-island-6", surface: 0.342 },
] as const;
const ISLAND_SET_PIECES = ["space-island-4", "space-island-5"] as const;
const PLAYER_TEXTURES = {
  idle: "player-idle",
  walkOne: "player-walk-one",
  walkTwo: "player-walk-two",
  crouch: "player-crouch",
  jumpRise: "player-jump-rise",
  jumpAir: "player-jump-air",
  landing: "player-landing",
  dash: "player-dash",
} as const;
const PLAYER_TEXTURE_BOTTOM_MARGIN: Record<string, number> = {
  [PLAYER_TEXTURES.idle]: 19 / 510,
  [PLAYER_TEXTURES.walkOne]: 22 / 495,
  [PLAYER_TEXTURES.walkTwo]: 19 / 480,
  [PLAYER_TEXTURES.crouch]: 20 / 430,
  [PLAYER_TEXTURES.jumpRise]: 35 / 425,
  [PLAYER_TEXTURES.jumpAir]: 19 / 450,
  [PLAYER_TEXTURES.landing]: 24 / 350,
  [PLAYER_TEXTURES.dash]: 33 / 375,
};
const PLAYER_ART_GROUNDING_OVERLAP = 2;
const ENEMY_SPRITE_SIZE = 168;
const ENEMY_KINDS: readonly EnemyKind[] = ["goblin", "mushroom", "skeleton", "flying-eye"];
const ENEMY_ATTACK_RANGE: Record<EnemyKind, number> = { goblin: 84, mushroom: 92, skeleton: 80, "flying-eye": 104 };
const ENEMY_MOVE_SPEED: Record<EnemyKind, number> = { goblin: 104, mushroom: 78, skeleton: 88, "flying-eye": 128 };

function createSegmentRandom(index: number) {
  let state = Math.imul(index + 1, 0x9e3779b1) >>> 0;
  return () => {
    let value = state += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export class TrialScene extends Phaser.Scene {
  private readonly controls: Controls;
  private readonly audio: AudioFeedback;
  private readonly onHud: (hud: TrialHud) => void;
  private readonly onResult: (result: TrialResult) => void;
  private player!: Phaser.GameObjects.Rectangle;
  private body!: Phaser.Physics.Arcade.Body;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private crystals!: Phaser.Physics.Arcade.StaticGroup;
  private readonly hazards: DamageHazard[] = [];
  private readonly generatedSegments: GeneratedSegment[] = [];
  private readonly enemies: EnemyUnit[] = [];
  private readonly checkpointFlags: Phaser.GameObjects.Triangle[] = [];
  private readonly score: ScoreState = createScoreState();
  private readonly scoreEvents: AttemptEvent[] = [];
  private readonly backgroundLayers: BackgroundLayer[] = [];
  private keys!: Keys;
  private playerArt!: Phaser.GameObjects.Image;
  private previous: MobileSnapshot = { left: false, right: false, jump: false, dash: false, attack: false };
  private runStartedAt = 0;
  private checkpointX = 75;
  private nextEndlessCheckpointX = WORLD_WIDTH + 80;
  private generatedChunkCount = 0;
  private lastEndlessIslandVariant = -1;
  private worldEndX = WORLD_WIDTH;
  private deaths = 0;
  private coyoteUntil = 0;
  private jumpBufferUntil = 0;
  private dashUntil = 0;
  private nextDashAt = 0;
  private invulnerableUntil = 0;
  private facing = 1;
  private hudAt = 0;
  private respawning = false;
  private finished = false;
  private attackUntil = 0;
  private attackVisual?: Phaser.GameObjects.Rectangle;
  private wasAirborne = false;
  private landingUntil = 0;
  private viewWidth = VIEW_WIDTH;

  constructor(controls: Controls, audio: AudioFeedback, onHud: (hud: TrialHud) => void, onResult: (result: TrialResult) => void) {
    super({ key: "TrialScene" });
    this.controls = controls;
    this.audio = audio;
    this.onHud = onHud;
    this.onResult = onResult;
  }

  preload() {
    for (const layer of BACKGROUND_LAYERS) this.load.image(layer.key, layer.path);
    for (let index = 0; index < ISLAND_PLATFORMS.length; index += 1) {
      this.load.image(ISLAND_PLATFORMS[index].key, `/space/island-${index === 3 ? 6 : index + 1}.webp`);
    }
    this.load.image(ISLAND_SET_PIECES[0], "/space/island-4.webp");
    this.load.image(ISLAND_SET_PIECES[1], "/space/island-5.webp");
    this.load.image(PICKUP_TEXTURE, "/items/cigarette-pack.webp");
    this.load.image(PLAYER_TEXTURES.idle, "/character/01_parado_idle.png");
    this.load.image(PLAYER_TEXTURES.walkOne, "/character/02_andando_passada_1.png");
    this.load.image(PLAYER_TEXTURES.walkTwo, "/character/03_andando_passada_2.png");
    this.load.image(PLAYER_TEXTURES.crouch, "/character/04_agachado.png");
    this.load.image(PLAYER_TEXTURES.jumpRise, "/character/05_pulo_subida.png");
    this.load.image(PLAYER_TEXTURES.jumpAir, "/character/06_pulo_no_ar.png");
    this.load.image(PLAYER_TEXTURES.landing, "/character/07_aterrissagem.png");
    this.load.image(PLAYER_TEXTURES.dash, "/character/08_dash_ataque.png");
    for (const kind of ENEMY_KINDS) {
      const root = `/monsters/${kind}`;
      for (const action of ["idle", "move", "attack", "hit", "death"] as const) {
        this.load.spritesheet(`monster-${kind}-${action}-sheet`, `${root}/${action}.png`, { frameWidth: 150, frameHeight: 150 });
      }
    }
  }

  create() {
    this.viewWidth = this.scale.gameSize.width;
    this.createEnemyAnimations();
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, VIEW_HEIGHT + 1_200);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, VIEW_HEIGHT);
    this.cameras.main.setZoom(1);
    this.drawBackdrop();
    this.addFloatingSetPiece(620, 52, 210, ISLAND_SET_PIECES[0]);
    this.addFloatingSetPiece(1_900, 58, 185, ISLAND_SET_PIECES[1]);
    this.addFloatingSetPiece(3_290, 48, 205, ISLAND_SET_PIECES[0]);

    this.platforms = this.physics.add.staticGroup();
    this.crystals = this.physics.add.staticGroup();
    for (const [zoneIndex, zone] of ZONES.entries()) {
      for (const [platformIndex, platform] of zone.platforms.entries()) {
        const height = platform.height ?? 60;
        const variant = (zoneIndex * 2 + platformIndex) % ISLAND_PLATFORMS.length;
        this.addIslandPlatform(platform.x, platform.y - height / 2, platform.width, height, variant);
      }
      for (const pickup of zone.crystals) {
        const crystal = this.add.image(pickup.x, pickup.y, PICKUP_TEXTURE).setDisplaySize(24, 40).setDepth(1);
        crystal.setData("crystalId", pickup.id);
        this.crystals.add(crystal);
        (crystal.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
        this.tweens.add({ targets: crystal, y: pickup.y - 6, duration: 650, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      }
      for (const hazard of zone.hazards) this.addHazard(hazard.x, hazard.y, hazard.width, hazard.height, hazard.kind);
      for (const enemy of zone.enemies) {
        this.addEnemy(enemy);
      }
      this.add.text(zone.start + 34, 92, zone.name, { fontFamily: "monospace", fontSize: "18px", color: "#6ff6ff", letterSpacing: 2 })
        .setScrollFactor(1).setDepth(1);
      this.add.rectangle(zone.start, 270, 2, 390, 0x37657c, 0.5);
      this.add.rectangle(zone.end, 270, 2, 390, 0x37657c, 0.5);
      this.addCheckpoint(zone.checkpoint);
    }

    this.add.text(4_040, 260, "ENDLESS / KEEP RUNNING", { fontFamily: "monospace", fontSize: "18px", color: "#c6b2ff" });
    this.player = this.add.rectangle(PLAYER_START_X, PLAYER_START_Y, 28, 40, 0xf3fbff, 0).setVisible(false);
    this.physics.add.existing(this.player);
    this.body = this.player.body as Phaser.Physics.Arcade.Body;
    this.body.setSize(PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT);
    this.body.setCollideWorldBounds(true);
    this.body.setGravityY(PHYSICS.gravity);
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.overlap(this.player, this.crystals, (_player, crystal) => this.collect(crystal as Phaser.GameObjects.Image), undefined, this);
    this.playerArt = this.add.image(PLAYER_START_X, GROUND_TOP, PLAYER_TEXTURES.idle)
      .setOrigin(0.5, 1).setScale(PLAYER_ART_SCALE).setDepth(2);
    this.positionPlayerArt();
    this.cameras.main.startFollow(this.player, true, 0.1, 0.08, -250, 0);
    this.cameras.main.setDeadzone(300, 130);

    this.keys = this.input.keyboard!.addKeys({
      left: "LEFT", right: "RIGHT", jump: "SPACE", dash: "SHIFT", attack: "X",
      a: "A", d: "D", w: "W", z: "Z", up: "UP", down: "DOWN", s: "S", c: "C",
    }) as Keys;
    this.runStartedAt = performance.now();
    this.emitHud();
  }

  private createEnemyAnimations() {
    for (const kind of ENEMY_KINDS) {
      const frameCounts = kind === "skeleton"
        ? { idle: 4, move: 4, attack: 8, hit: 4, death: 4 }
        : kind === "flying-eye"
          ? { idle: 8, move: 8, attack: 8, hit: 4, death: 4 }
          : { idle: 4, move: 8, attack: 8, hit: 4, death: 4 };
      for (const action of ["idle", "move", "attack", "hit", "death"] as const) {
        const key = `monster-${kind}-${action}`;
        if (this.anims.exists(key)) continue;
        const sheetKey = `${key}-sheet`;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(sheetKey, { start: 0, end: frameCounts[action] - 1 }),
          frameRate: action === "idle" ? 5 : action === "attack" ? 10 : 9,
          repeat: action === "idle" || action === "move" ? -1 : 0,
        });
      }
    }
  }

  private addEnemy(spec: EnemySpec, segment?: GeneratedSegment) {
    const flying = spec.kind === "flying-eye";
    const minX = spec.minX ?? spec.x - 105;
    const maxX = spec.maxX ?? spec.x + 105;
    const sprite = this.add.sprite(spec.x, flying ? spec.y : spec.y - 28, `monster-${spec.kind}-idle-sheet`)
      .setDisplaySize(ENEMY_SPRITE_SIZE, ENEMY_SPRITE_SIZE)
      .setDepth(2);
    const hitbox = this.add.rectangle(spec.x, flying ? spec.y : spec.y - 24, flying ? 48 : 46, flying ? 46 : 52, 0, 0)
      .setVisible(false)
      .setDepth(1);
    const enemy: EnemyUnit = {
      id: spec.id,
      kind: spec.kind,
      sprite,
      hitbox,
      homeX: spec.x,
      baseY: spec.y,
      minX: Math.min(minX, maxX),
      maxX: Math.max(minX, maxX),
      direction: 1,
      state: "patrol",
      stateUntil: 0,
      impactAt: 0,
      attackHit: false,
      nextAttackAt: this.time.now + 900 + ENEMY_KINDS.indexOf(spec.kind) * 250,
      health: spec.kind === "skeleton" ? 3 : spec.kind === "mushroom" ? 1 : 2,
    };
    this.enemies.push(enemy);
    this.playEnemyAnimation(enemy, "idle");
    segment?.enemies.push(enemy);
    segment?.objects.push(sprite, hitbox);
    return enemy;
  }

  private playEnemyAnimation(enemy: EnemyUnit, action: "idle" | "move" | "attack" | "hit" | "death") {
    const key = `monster-${enemy.kind}-${action}`;
    if (enemy.sprite.anims.currentAnim?.key !== key) enemy.sprite.anims.play(key);
  }

  private drawBackdrop() {
    for (const layer of BACKGROUND_LAYERS) {
      const sprite = this.add.tileSprite(this.viewWidth / 2, VIEW_HEIGHT / 2, this.viewWidth, VIEW_HEIGHT, layer.key)
        .setOrigin(0.5)
        .setTileScale(Math.max(this.viewWidth / 384, VIEW_HEIGHT / 216))
        .setScrollFactor(0)
        .setAlpha(layer.alpha)
        .setDepth(layer.depth);
      this.backgroundLayers.push({ sprite, parallax: layer.parallax });
    }
  }

  private updateBackdrop() {
    const cameraX = this.cameras.main.scrollX;
    for (const layer of this.backgroundLayers) layer.sprite.setTilePosition(cameraX * layer.parallax, 0);
  }

  private addIslandPlatform(x: number, surfaceY: number, width: number, height: number, variantIndex: number, segment?: GeneratedSegment) {
    const variant = ISLAND_PLATFORMS[variantIndex % ISLAND_PLATFORMS.length];
    const source = this.textures.get(variant.key).getSourceImage() as HTMLImageElement;
    const artHeight = width * source.height / source.width;
    const art = this.add.image(x, surfaceY - artHeight * variant.surface, variant.key)
      .setOrigin(0.5, 0)
      .setDisplaySize(width, artHeight)
      .setDepth(-1);
    const platform = this.add.rectangle(x, surfaceY + height / 2, width, height, 0x000000, 0).setVisible(false);
    this.platforms.add(platform);
    (platform.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
    if (segment) {
      segment.platforms.push(platform);
      segment.objects.push(platform, art);
    }
    return platform;
  }

  private addFloatingSetPiece(x: number, topY: number, width: number, texture: typeof ISLAND_SET_PIECES[number], objects?: Phaser.GameObjects.GameObject[]) {
    const source = this.textures.get(texture).getSourceImage() as HTMLImageElement;
    const height = width * source.height / source.width;
    const image = this.add.image(x, topY, texture)
      .setOrigin(0.5, 0)
      .setDisplaySize(width, height)
      .setDepth(-4)
      .setAlpha(0.92);
    objects?.push(image);
    return image;
  }

  private addHazard(x: number, y: number, width: number, height: number, kind: string, segment?: GeneratedSegment, difficulty = 0) {
    const color = kind === "laser" ? 0xff326f : kind === "saw" ? 0xffa648 : 0xff3968;
    const shape = this.add.rectangle(x, y, width, height, color, kind === "laser" ? 0.72 : 0.95)
      .setStrokeStyle(2, kind === "laser" ? 0xffa2c0 : 0xffd0db);
    const ring = kind === "saw" ? this.add.circle(x, y, Math.min(width, height) / 2 + 5, 0x39172a).setStrokeStyle(2, 0xff7853) : undefined;
    const hazard = {
      shape, ring, baseX: x, moving: kind === "saw", phase: x / 155, kind,
      period: Math.max(260, 420 - difficulty * 18), amplitude: Math.min(75 + difficulty * 5, 110),
    };
    this.hazards.push(hazard);
    if (segment) {
      segment.hazards.push(hazard);
      segment.objects.push(shape);
      if (ring) segment.objects.push(ring);
    }
  }

  private addCheckpoint(x: number, objects?: Phaser.GameObjects.GameObject[]) {
    const post = this.add.rectangle(x, 425, 8, 100, 0x243448).setStrokeStyle(2, 0x8c69ff, 0.8);
    const flag = this.add.triangle(x + 13, 385, 0, 0, 25, 12, 0, 24, 0x725cff).setOrigin(0, 0.5);
    this.checkpointFlags.push(flag);
    objects?.push(post, flag);
    return flag;
  }

  private ensureWorldAhead() {
    while (this.player.x + CHUNK_AHEAD * this.viewWidth >= WORLD_WIDTH + this.generatedChunkCount * SEGMENT_LENGTH) {
      this.addEndlessSegment(this.generatedChunkCount);
      this.generatedChunkCount += 1;
    }

    const cameraLeft = this.cameras.main.worldView.x;
    for (let index = this.generatedSegments.length - 1; index >= 0; index -= 1) {
      const segment = this.generatedSegments[index];
      if (segment.end >= this.checkpointX - SEGMENT_LENGTH || segment.renderEnd >= cameraLeft - 200) continue;
      for (const platform of segment.platforms) this.platforms.remove(platform, true, true);
      for (const pickup of segment.pickups) this.crystals.remove(pickup, true, true);
      for (const hazard of segment.hazards) {
        const hazardIndex = this.hazards.indexOf(hazard);
        if (hazardIndex >= 0) this.hazards.splice(hazardIndex, 1);
      }
      for (const enemy of segment.enemies) {
        const enemyIndex = this.enemies.indexOf(enemy);
        if (enemyIndex >= 0) this.enemies.splice(enemyIndex, 1);
      }
      for (const object of segment.objects) {
        if (segment.platforms.includes(object as Phaser.GameObjects.Rectangle)) continue;
        if (object.scene) object.destroy();
      }
      const flagIndex = segment.checkpoint ? this.checkpointFlags.indexOf(segment.checkpoint) : -1;
      if (flagIndex >= 0) this.checkpointFlags.splice(flagIndex, 1);
      this.generatedSegments.splice(index, 1);
    }
  }

  private addEndlessSegment(index: number) {
    const start = WORLD_WIDTH + index * SEGMENT_LENGTH;
    const end = start + SEGMENT_LENGTH;
    const difficulty = Math.floor(index / 2);
    const random = createSegmentRandom(index);
    const gap = Math.min(48 + difficulty * 8 + Math.floor(random() * 24), 115);
    const availableWidth = SEGMENT_LENGTH - 40 - gap * 2;
    const widthFactors = [0.82 + random() * 0.36, 0.82 + random() * 0.36, 0.82 + random() * 0.36];
    const widthFactorTotal = widthFactors.reduce((total, factor) => total + factor, 0);
    const platformWidths = widthFactors.map((factor) => availableWidth * factor / widthFactorTotal);
    const secondHeight = 420 + Math.floor(random() * 61);
    const thirdHeight = Phaser.Math.Clamp(secondHeight + Math.floor(random() * 91) - 45, 420, 480);
    const segment: GeneratedSegment = {
      start,
      end,
      renderEnd: end,
      checkpointX: start + 80,
      platforms: [],
      pickups: [],
      objects: [],
      hazards: [],
      enemies: [],
    };

    if (random() < 0.72) {
      const texture = ISLAND_SET_PIECES[Math.floor(random() * ISLAND_SET_PIECES.length)];
      this.addFloatingSetPiece(start + 360 + random() * 280, 34 + random() * 64, 155 + random() * 80, texture, segment.objects);
    }

    const platforms: Array<{ center: number; surfaceY: number; width: number }> = [];
    let left = start + 20;
    for (let part = 0; part < 3; part += 1) {
      const width = platformWidths[part];
      const center = left + width / 2;
      const surfaceY = [480, secondHeight, thirdHeight][part];
      let variant = Math.floor(random() * ISLAND_PLATFORMS.length);
      if (variant === this.lastEndlessIslandVariant) variant = (variant + 1 + Math.floor(random() * (ISLAND_PLATFORMS.length - 1))) % ISLAND_PLATFORMS.length;
      this.lastEndlessIslandVariant = variant;
      this.addIslandPlatform(center, surfaceY, width, 60, variant, segment);
      platforms.push({ center, surfaceY, width });

      const pickup = this.add.image(center, surfaceY - 24, PICKUP_TEXTURE).setDisplaySize(24, 40).setDepth(1);
      pickup.setData("crystalId", `endless-${index}-${part}`);
      this.crystals.add(pickup);
      (pickup.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      this.tweens.add({ targets: pickup, y: surfaceY - 30, duration: 650, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      segment.pickups.push(pickup);

      left += width + gap;
    }

    const hazardCount = Math.min(3 + Math.floor(index / 2), 6);
    for (let obstacle = 0; obstacle < hazardCount; obstacle += 1) {
      const platformIndex = obstacle % platforms.length;
      const slot = Math.floor(obstacle / platforms.length);
      const firstSlotSide = platformIndex === 0 ? 1 : -1;
      const side = slot % 2 === 0 ? firstSlotSide : -firstSlotSide;
      const platform = platforms[platformIndex];
      const x = platform.center + side * platform.width * 0.28;
      const kind = difficulty >= 5 && obstacle % 3 === 2 ? "laser" : difficulty >= 2 && obstacle % 2 === 1 ? "saw" : "spike";
      const surfaceY = platform.surfaceY;
      this.addHazard(x, surfaceY - (kind === "laser" ? 55 : 15), kind === "laser" ? 14 : 42 + Math.min(difficulty * 2, 20), kind === "laser" ? 110 : 30, kind, segment, difficulty);
    }

    const monsterCount = difficulty >= 4 && random() > 0.62 ? 2 : 1;
    for (let encounter = 0; encounter < monsterCount; encounter += 1) {
      const platform = platforms[(encounter + Math.floor(random() * platforms.length)) % platforms.length];
      const kind = ENEMY_KINDS[Math.floor(random() * ENEMY_KINDS.length)];
      const minX = platform.center - platform.width / 2 + 26;
      const maxX = platform.center + platform.width / 2 - 26;
      const spawnX = Phaser.Math.Clamp(platform.center + (random() - 0.5) * Math.max(0, platform.width - 72), minX, maxX);
      const spawnY = kind === "flying-eye" ? Phaser.Math.Clamp(platform.surfaceY - 135, 120, 360) : platform.surfaceY;
      this.addEnemy({
        x: spawnX,
        y: spawnY,
        minX,
        maxX,
        kind,
        id: `endless-${index}-monster-${encounter}`,
      }, segment);
    }

    segment.checkpoint = this.addCheckpoint(segment.checkpointX, segment.objects);
    this.generatedSegments.push(segment);
    this.worldEndX = end + CHUNK_AHEAD * this.viewWidth;
    this.physics.world.setBounds(0, 0, this.worldEndX, VIEW_HEIGHT + 1_200);
    this.cameras.main.setBounds(0, 0, this.worldEndX, VIEW_HEIGHT);
  }

  private collect(crystal: Phaser.GameObjects.Image) {
    const id = crystal.getData("crystalId") as string | undefined;
    if (!id || !this.award("crystal", `crystal:${id}`)) return;
    this.audio.play("crystal");
    this.crystals.remove(crystal, true, true);
    this.emitHud();
  }

  update(time: number, delta: number) {
    if (this.finished || this.respawning) return;
    this.updateBackdrop();
    this.ensureWorldAhead();
    const keyboard = this.keys;
    const mobile = this.controls.snapshot();
    const input = {
      left: mobile.left || keyboard.left.isDown || keyboard.a.isDown,
      right: mobile.right || keyboard.right.isDown || keyboard.d.isDown,
      jump: mobile.jump || keyboard.jump.isDown || keyboard.w.isDown || keyboard.z.isDown || keyboard.up.isDown,
      dash: mobile.dash || keyboard.dash.isDown || keyboard.c.isDown,
      attack: mobile.attack || keyboard.attack.isDown,
      down: keyboard.down.isDown || keyboard.s.isDown,
    };
    const justPressed = (action: keyof MobileSnapshot) => input[action] && !this.previous[action];
    if (input.left) this.facing = -1;
    if (input.right) this.facing = 1;
    const grounded = this.body.blocked.down || this.body.touching.down;
    if (grounded) this.coyoteUntil = time + PHYSICS.coyoteMs;
    if (justPressed("jump")) this.jumpBufferUntil = time + PHYSICS.jumpBufferMs;

    const direction = Number(input.right) - Number(input.left);
    if (grounded && this.wasAirborne) {
      this.landingUntil = time + 190;
      this.wasAirborne = false;
    } else if (!grounded) {
      this.wasAirborne = true;
    }
    if (time < this.dashUntil) {
      this.body.setVelocity(this.facing * PHYSICS.dashSpeed, 0);
      this.body.setAllowGravity(false);
    } else {
      this.body.setAllowGravity(true);
      if (direction) this.body.setAccelerationX(direction * PHYSICS.acceleration);
      else this.body.setAccelerationX(0).setDragX(PHYSICS.friction);
      this.body.setMaxVelocityX(PHYSICS.runSpeed);

      if (time < this.jumpBufferUntil && (time < this.coyoteUntil || grounded)) {
        this.body.setVelocityY(-PHYSICS.jumpSpeed);
        this.audio.play("jump");
        this.jumpBufferUntil = 0;
        this.coyoteUntil = 0;
      } else if (time < this.jumpBufferUntil && (this.body.blocked.left || this.body.blocked.right)) {
        this.facing = this.body.blocked.left ? 1 : -1;
        this.body.setVelocity(this.facing * PHYSICS.wallJumpX, -PHYSICS.jumpSpeed * 0.94);
        this.audio.play("jump");
        this.jumpBufferUntil = 0;
      }

      this.body.setVelocityY(jumpVelocityAfterRelease(this.body.velocity.y, input.jump));
      if (justPressed("dash") && time >= this.nextDashAt) {
        if (direction) this.facing = direction;
        this.dashUntil = time + PHYSICS.dashDurationMs;
        this.nextDashAt = time + PHYSICS.dashCooldownMs;
        this.audio.play("dash");
      }
    }

    if (justPressed("attack")) this.startAttack(time);
    this.updateAttack(time);
    this.updateHazards(time);
    if (this.respawning || this.finished) {
      this.previous = input;
      return;
    }
    this.updateEnemies(time, delta);
    if (this.respawning || this.finished) {
      this.previous = input;
      return;
    }
    this.updateProgress();
    if (this.player.y > VIEW_HEIGHT + 60) {
      this.die();
      this.previous = input;
      return;
    }

    this.updatePlayerArt(time, grounded, direction, input.down);
    this.playerArt.setTint(time < this.invulnerableUntil ? 0x62ffb3 : 0xffffff);
    if (time >= this.hudAt) this.emitHud();
    this.previous = input;
  }

  private updatePlayerArt(time: number, grounded: boolean, direction: number, crouching: boolean) {
    let texture: string = PLAYER_TEXTURES.idle;
    if (time < this.dashUntil || time < this.attackUntil) texture = PLAYER_TEXTURES.dash;
    else if (grounded && crouching) texture = PLAYER_TEXTURES.crouch;
    else if (grounded && time < this.landingUntil) texture = PLAYER_TEXTURES.landing;
    else if (!grounded) texture = this.body.velocity.y < 0 ? PLAYER_TEXTURES.jumpRise : PLAYER_TEXTURES.jumpAir;
    else if (direction) texture = Math.floor(time / 150) % 2 === 0 ? PLAYER_TEXTURES.walkOne : PLAYER_TEXTURES.walkTwo;

    if (this.playerArt.texture.key !== texture) this.playerArt.setTexture(texture);
    this.positionPlayerArt();
    this.playerArt.setFlipX(this.facing < 0);
    this.playerArt.setAlpha(this.respawning ? 0.55 : 1);
  }

  private positionPlayerArt() {
    const bottomMargin = PLAYER_TEXTURE_BOTTOM_MARGIN[this.playerArt.texture.key] ?? 0;
    const visibleFootOffset = this.playerArt.displayHeight * bottomMargin;
    this.playerArt.setPosition(
      this.player.x,
      this.player.y + PLAYER_ART_FOOT_OFFSET + visibleFootOffset + PLAYER_ART_GROUNDING_OVERLAP,
    );
  }

  private updateHazards(time: number) {
    for (const hazard of this.hazards) {
      if (hazard.moving) hazard.shape.x = hazard.baseX + Math.sin(time / hazard.period + hazard.phase) * hazard.amplitude;
      if (hazard.kind === "laser") {
        const active = Math.floor((time + hazard.phase * 200) / 1_000) % 2 === 0;
        hazard.shape.setAlpha(active ? 0.82 : 0.12);
        hazard.shape.setData("active", active);
      }
      if (hazard.ring) hazard.ring.x = hazard.shape.x;
      if (time > this.invulnerableUntil && this.rectanglesOverlap(this.player, hazard.shape) && (hazard.kind !== "laser" || hazard.shape.getData("active"))) {
        this.die();
        return;
      }
    }
  }

  private updateEnemies(time: number, delta: number) {
    const step = Phaser.Math.Clamp(delta, 0, 50) / 1_000;
    for (const enemy of this.enemies) {
      if (!enemy.sprite.active) continue;
      if (enemy.state === "dying") {
        if (time >= enemy.stateUntil) {
          enemy.sprite.destroy();
          enemy.hitbox.destroy();
        }
        continue;
      }
      if (enemy.state === "hit") {
        if (time < enemy.stateUntil) continue;
        enemy.state = "approach";
      }

      const flying = enemy.kind === "flying-eye";
      const dx = this.player.x - enemy.sprite.x;
      const dy = this.player.y - enemy.hitbox.y;
      const distance = Math.abs(dx);
      const attackRange = ENEMY_ATTACK_RANGE[enemy.kind];
      const verticalRange = flying ? 120 : 88;
      const canReachPlayer = distance < attackRange + 22 && Math.abs(dy) < verticalRange;

      if (enemy.state === "attack") {
        enemy.direction = dx < 0 ? -1 : 1;
        enemy.sprite.setFlipX(enemy.direction < 0);
        if (!enemy.attackHit && time >= enemy.impactAt) {
          enemy.attackHit = true;
          const stillInRange = Math.abs(this.player.x - enemy.sprite.x) < attackRange + 24
            && Math.abs(this.player.y - enemy.hitbox.y) < verticalRange;
          if (stillInRange && time >= this.invulnerableUntil) {
            this.die();
            return;
          }
        }
        if (time >= enemy.stateUntil) {
          enemy.state = "approach";
          this.playEnemyAnimation(enemy, "move");
        }
        continue;
      }

      const aggro = distance < (flying ? 560 : 390) && Math.abs(dy) < (flying ? 240 : 150);
      let moving = false;
      if (flying) {
        const patrolSpan = Math.max(0, Math.min(72, (enemy.maxX - enemy.minX) / 2 - 20));
        const targetX = aggro
          ? Phaser.Math.Clamp(this.player.x - Math.sign(dx || enemy.direction) * 76, enemy.minX, enemy.maxX)
          : Phaser.Math.Clamp(enemy.homeX + Math.sin(time / 1_100 + enemy.homeX) * patrolSpan, enemy.minX, enemy.maxX);
        const horizontalStep = targetX - enemy.sprite.x;
        if (Math.abs(horizontalStep) > 5) {
          enemy.direction = Math.sign(horizontalStep);
          enemy.sprite.x += enemy.direction * Math.min(Math.abs(horizontalStep), ENEMY_MOVE_SPEED[enemy.kind] * step);
          moving = true;
        } else if (aggro && distance > attackRange - 12) {
          enemy.direction = dx < 0 ? -1 : 1;
        }
        const targetY = aggro
          ? Phaser.Math.Clamp(this.player.y - 68, 100, VIEW_HEIGHT - 105)
          : enemy.baseY + Math.sin(time / 720 + enemy.homeX) * 20;
        enemy.sprite.y = Phaser.Math.Linear(enemy.sprite.y, targetY, Math.min(1, step * 2.8));
        enemy.hitbox.setPosition(enemy.sprite.x, enemy.sprite.y);
      } else {
        if (aggro && distance > attackRange - 10) {
          enemy.direction = dx < 0 ? -1 : 1;
          const previousX = enemy.sprite.x;
          const nextX = previousX + enemy.direction * Math.min(distance - attackRange + 10, ENEMY_MOVE_SPEED[enemy.kind] * step);
          enemy.sprite.x = Phaser.Math.Clamp(nextX, enemy.minX, enemy.maxX);
          moving = Math.abs(enemy.sprite.x - previousX) > 0.1;
        } else if (!aggro) {
          if (enemy.sprite.x <= enemy.minX + 2) enemy.direction = 1;
          if (enemy.sprite.x >= enemy.maxX - 2) enemy.direction = -1;
          const previousX = enemy.sprite.x;
          const nextX = previousX + enemy.direction * ENEMY_MOVE_SPEED[enemy.kind] * 0.32 * step;
          enemy.sprite.x = Phaser.Math.Clamp(nextX, enemy.minX, enemy.maxX);
          moving = Math.abs(enemy.sprite.x - previousX) > 0.1;
        }
        enemy.hitbox.setPosition(enemy.sprite.x, enemy.baseY - 24);
      }

      enemy.sprite.setFlipX(enemy.direction < 0);
      if (aggro && canReachPlayer && time >= enemy.nextAttackAt) {
        enemy.direction = dx < 0 ? -1 : 1;
        enemy.state = "attack";
        enemy.stateUntil = time + 920;
        enemy.impactAt = time + 500;
        enemy.attackHit = false;
        enemy.nextAttackAt = time + 2_000;
        enemy.sprite.setFlipX(enemy.direction < 0);
        this.playEnemyAnimation(enemy, "attack");
      } else {
        enemy.state = aggro ? "approach" : "patrol";
        this.playEnemyAnimation(enemy, moving ? "move" : "idle");
      }
    }
  }

  private startAttack(time: number) {
    this.attackUntil = time + 180;
    this.audio.play("attack");
    this.attackVisual?.destroy();
    this.attackVisual = this.add.rectangle(this.player.x + this.facing * 28, this.player.y, 48, 34, 0x88f7ff, 0.3)
      .setStrokeStyle(2, 0x9fffff).setDepth(2);
    for (const enemy of this.enemies) {
      if (!enemy.sprite.active || enemy.state === "dying") continue;
      const dx = enemy.sprite.x - this.player.x;
      const inFront = dx * this.facing >= -8 && Math.abs(dx) < 108;
      const verticalRange = enemy.kind === "flying-eye" ? 132 : 106;
      if (inFront && Math.abs(enemy.hitbox.y - this.player.y) < verticalRange) this.hitEnemy(enemy, time);
    }
  }

  private hitEnemy(enemy: EnemyUnit, time: number) {
    enemy.health -= 1;
    this.audio.play("hit");
    if (enemy.health > 0) {
      enemy.state = "hit";
      enemy.stateUntil = time + 380;
      enemy.nextAttackAt = Math.max(enemy.nextAttackAt, time + 550);
      this.playEnemyAnimation(enemy, "hit");
      return;
    }
    enemy.state = "dying";
    enemy.stateUntil = time + 560;
    enemy.hitbox.setActive(false);
    this.playEnemyAnimation(enemy, "death");
    this.award("target", `target:${enemy.id}`);
  }

  private updateAttack(time: number) {
    if (!this.attackVisual) return;
    if (time >= this.attackUntil) {
      this.attackVisual.destroy();
      this.attackVisual = undefined;
    } else {
      this.attackVisual.setPosition(this.player.x + this.facing * 28, this.player.y);
    }
  }

  private updateProgress() {
    for (let index = 1; index < ZONES.length; index += 1) {
      if (this.player.x >= ZONES[index].start && this.award("section", `section:${index}`)) {
        this.audio.play("zone");
        this.emitHud();
      }
    }
    for (let index = 0; index < ZONES.length; index += 1) {
      const boundary = ZONES[index].end;
      if (this.player.x >= boundary && this.award("zone", `zone:${index}`)) this.emitHud();
      if (this.player.x >= ZONES[index].checkpoint && this.checkpointX < ZONES[index].checkpoint) {
        this.checkpointX = ZONES[index].checkpoint;
        this.checkpointFlags[index]?.setFillStyle(0x43e7f5);
        this.audio.play("checkpoint");
        this.emitHud();
      }
    }
    while (this.player.x >= this.nextEndlessCheckpointX) {
      this.checkpointX = this.nextEndlessCheckpointX;
      const segment = this.generatedSegments.find((item) => item.checkpointX === this.checkpointX);
      segment?.checkpoint?.setFillStyle(0x43e7f5);
      this.nextEndlessCheckpointX += SEGMENT_LENGTH;
      this.audio.play("checkpoint");
      this.emitHud();
    }
  }

  private die() {
    if (this.respawning || this.finished || performance.now() < this.invulnerableUntil) return;
    this.respawning = true;
    this.deaths += 1;
    this.audio.play("death");
    this.audio.haptic(110);
    this.award("death", `death:${this.deaths}`);
    this.controls.releaseAll();
    this.playerArt.setAlpha(0.55);
    this.emitHud();
    if (this.deaths >= STARTING_LIVES) {
      this.finished = true;
      this.physics.pause();
      this.onResult({
        ...this.hud(),
        completed: true,
        elapsedMs: Math.max(0, Math.floor(performance.now() - this.runStartedAt)),
        gameVersion: GAME_VERSION,
        events: [...this.scoreEvents],
        zonesCompleted: Math.floor(this.player.x / SEGMENT_LENGTH),
      });
      return;
    }
    this.time.delayedCall(420, () => {
      this.player.setPosition(this.checkpointX, PLAYER_START_Y).setAlpha(1);
      this.body.setVelocity(0, 0);
      this.body.setAllowGravity(true);
      this.playerArt.setTexture(PLAYER_TEXTURES.idle);
      this.positionPlayerArt();
      this.playerArt.setAlpha(1);
      this.invulnerableUntil = this.time.now + 1_050;
      this.nextDashAt = this.time.now;
      this.respawning = false;
      this.emitHud();
    });
  }

  private award(event: ScoreEvent, key: string) {
    if (!awardScore(this.score, event, key)) return false;
    this.scoreEvents.push({ event, key, at_ms: Math.max(0, Math.round(performance.now() - this.runStartedAt)), x: Math.round(this.player?.x ?? 0) });
    return true;
  }

  private rectanglesOverlap(a: Phaser.GameObjects.Rectangle, b: Phaser.GameObjects.Rectangle) {
    return Phaser.Geom.Intersects.RectangleToRectangle(a.getBounds(), b.getBounds());
  }

  private hud(): TrialHud {
    const distance = Math.max(0, Math.floor(this.player?.x ?? 0));
    const elapsedSeconds = Math.floor(Math.max(0, performance.now() - this.runStartedAt) / 1_000);
    return {
      score: this.score.value + elapsedSeconds * SURVIVAL_SCORE_PER_SECOND,
      zone: Math.floor(distance / SEGMENT_LENGTH) + 1,
      deaths: this.deaths,
      lives: Math.max(0, STARTING_LIVES - this.deaths),
      distance,
      dashReady: this.time.now >= this.nextDashAt,
      checkpoint: ZONES.filter((zone) => zone.checkpoint <= this.checkpointX).length
        + Math.max(0, Math.floor((this.checkpointX - (WORLD_WIDTH + 80)) / SEGMENT_LENGTH) + 1),
    };
  }

  private emitHud() {
    this.hudAt = this.time.now + 150;
    this.onHud(this.hud());
  }
}
