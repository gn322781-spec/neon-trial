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
type DamageHazard = { shape: Phaser.GameObjects.Rectangle; visual: Phaser.GameObjects.Sprite };
type EnemyState = "hover" | "approach" | "attack" | "hit" | "dying";
type EnemyProjectile = { sprite: Phaser.GameObjects.Image; velocityX: number; velocityY: number; expiresAt: number };
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
  checkpoint?: Phaser.GameObjects.Sprite;
  platforms: Phaser.GameObjects.Rectangle[];
  pickups: Phaser.GameObjects.Image[];
  motorcyclePickups: Phaser.GameObjects.Image[];
  objects: Phaser.GameObjects.GameObject[];
  hazards: DamageHazard[];
  enemies: EnemyUnit[];
};
type BackgroundLayer = { sprite: Phaser.GameObjects.TileSprite; parallax: number };
type CheckpointSurface = { left: number; right: number; surfaceY: number };
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
const PLAYER_ART_HEIGHT = 510 * PLAYER_ART_SCALE;
const PLAYER_ATTACK_DURATION_MS = 180;
const PLAYER_BODY_WIDTH = 40;
const PLAYER_BODY_HEIGHT = 66;
const PLAYER_START_X = 75;
const GROUND_TOP = 480;
const PLAYER_START_Y = GROUND_TOP - PLAYER_BODY_HEIGHT / 2;
const PLAYER_ART_FOOT_OFFSET = PLAYER_BODY_HEIGHT / 2;
const PICKUP_TEXTURE = "cigarette-pack";
const BACKGROUND_LAYERS = [
  { key: "forest-sky", path: "/forest/layers/sky.png", parallax: 0.002, depth: -40, alpha: 1 },
  { key: "forest-stars-back", path: "/forest/layers/particles-2.png", parallax: 0.008, depth: -39, alpha: 1 },
  { key: "forest-stars-front", path: "/forest/layers/particles-1.png", parallax: 0.025, depth: -38, alpha: 1 },
  { key: "forest-mountain-ridge", path: "/forest/layers/mountain-ridge.png", parallax: 0.035, depth: -36, alpha: 1 },
  { key: "forest-mountain-walls", path: "/forest/layers/mountain-walls.png", parallax: 0.05, depth: -35, alpha: 1 },
  { key: "forest-mountain-peak", path: "/forest/layers/mountain-peak.png", parallax: 0.075, depth: -34, alpha: 1 },
  { key: "forest-tree-5", path: "/forest/layers/tree-5.png", parallax: 0.1, depth: -31, alpha: 1 },
  { key: "forest-tree-4", path: "/forest/layers/tree-4.png", parallax: 0.12, depth: -30, alpha: 1 },
  { key: "forest-tree-3", path: "/forest/layers/tree-3.png", parallax: 0.15, depth: -29, alpha: 1 },
  { key: "forest-tree-2", path: "/forest/layers/tree-2.png", parallax: 0.18, depth: -28, alpha: 1 },
  { key: "forest-tree-1", path: "/forest/layers/tree-1.png", parallax: 0.21, depth: -27, alpha: 1 },
  { key: "forest-vegetation-3", path: "/forest/layers/vegetation-3.png", parallax: 0.22, depth: -25, alpha: 1 },
  { key: "forest-vegetation-2", path: "/forest/layers/vegetation-2.png", parallax: 0.25, depth: -24, alpha: 1 },
  { key: "forest-vegetation-1", path: "/forest/layers/vegetation-1.png", parallax: 0.28, depth: -23, alpha: 1 },
  { key: "forest-color-filter", path: "/forest/layers/color-filter.png", parallax: 0, depth: -22, alpha: 1 },
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
const PLAYER_ATTACK_TEXTURES = [
  "player-punch-01",
  "player-punch-02",
  "player-punch-03",
] as const;
const PLAYER_ATTACK_FRAME_HEIGHTS: readonly number[] = [542, 621, 1649];
const PLAYER_TEXTURE_BOTTOM_MARGIN: Record<string, number> = {
  [PLAYER_TEXTURES.idle]: 19 / 510,
  [PLAYER_TEXTURES.walkOne]: 22 / 495,
  [PLAYER_TEXTURES.walkTwo]: 19 / 480,
  [PLAYER_TEXTURES.crouch]: 20 / 430,
  [PLAYER_TEXTURES.jumpRise]: 35 / 425,
  [PLAYER_TEXTURES.jumpAir]: 19 / 450,
  [PLAYER_TEXTURES.landing]: 24 / 350,
  [PLAYER_TEXTURES.dash]: 33 / 375,
  [PLAYER_ATTACK_TEXTURES[0]]: 10 / 542,
  [PLAYER_ATTACK_TEXTURES[1]]: 8 / 621,
  [PLAYER_ATTACK_TEXTURES[2]]: 80 / 1649,
};
const PLAYER_ART_GROUNDING_OVERLAP = 2;
const MOTORCYCLE_TEXTURE = "green-motorcycle";
const MOTORCYCLE_MOUNT_TEXTURE = "motorcycle-mount";
const MOTORCYCLE_RIDING_TEXTURE = "motorcycle-riding";
const HAZARD_SMOKE_ORB_SHEET = "hazard-smoke-orb-sheet";
const HAZARD_SMOKE_ORB_ANIMATION = "hazard-smoke-orb";
const CHECKPOINT_ALTAR_TEXTURE = "checkpoint-altar";
const CHECKPOINT_ALTAR_ANIMATION = "checkpoint-altar-idle";
const CHECKPOINT_ALTAR_FRAME_SIZE = { frameWidth: 654, frameHeight: 600 };
const CHECKPOINT_ALTAR_DISPLAY_SIZE = { width: 88, height: 81 };
// Each source frame has a different transparent margin around the carpet.
const CHECKPOINT_ALTAR_FRAME_ANCHORS = [
  { x: 335.5 / 654, y: 566 / 600 },
  { x: 320.5 / 654, y: 566 / 600 },
  { x: 336 / 654, y: 531 / 600 },
  { x: 320.5 / 654, y: 532 / 600 },
] as const;
const CHECKPOINT_GLOW_ANIMATION = "checkpoint-glow-loop";
const CHECKPOINT_GLOW_DISPLAY_SIZE = { width: 88, height: 59 };
// Visible center and bottom of the six smoke orb frames in the 512px cells.
const HAZARD_SMOKE_ORB_FRAME_ANCHORS = [
  { x: 271.5 / 512, y: 458 / 512 },
  { x: 259 / 512, y: 457 / 512 },
  { x: 247.5 / 512, y: 457 / 512 },
  { x: 270.5 / 512, y: 435 / 512 },
  { x: 261.5 / 512, y: 435 / 512 },
  { x: 251.5 / 512, y: 439 / 512 },
] as const;
const GAME_EFFECTS = [
  { key: "fx-attack-impact", path: "/effects/gigapack/directional_impact_001_small_blue.png", frameWidth: 32, frameHeight: 32, frameCount: 7 },
  { key: "fx-player-impact", path: "/effects/gigapack/symmetrical_impact_001_small_yellow.png", frameWidth: 48, frameHeight: 48, frameCount: 7 },
  { key: "fx-dash-smoke", path: "/effects/gigapack/directional_smoke_burst_001_small_white.png", frameWidth: 32, frameHeight: 32, frameCount: 21 },
  { key: "fx-collect-sparkle", path: "/effects/gigapack/round_sparkle_burst_001_small_blue.png", frameWidth: 32, frameHeight: 32, frameCount: 14 },
  { key: "fx-enemy-explosion", path: "/effects/gigapack/symmetrical_explosion_001_small_orange.png", frameWidth: 32, frameHeight: 32, frameCount: 8 },
  { key: "fx-checkpoint-glow", path: "/checkpoints/cyan-sparkle-sheet.png", frameWidth: 768, frameHeight: 512, frameCount: 4 },
] as const;
const MOTORCYCLE_RIDE_FRAME_TEXTURES = [
  "motorcycle-ride-frame-01",
  "motorcycle-ride-frame-02",
  "motorcycle-ride-frame-03",
  "motorcycle-ride-frame-04",
  "motorcycle-ride-frame-05",
  "motorcycle-ride-frame-06",
] as const;
// Bottom row of the motorcycle wheels in each 528x540 source frame.
const MOTORCYCLE_RIDE_FRAME_BASELINES = [520, 520, 520, 455, 454, 455] as const;
const MOTORCYCLE_RIDE_FRAME_SOURCE_HEIGHT = 540;
const MOTORCYCLE_RIDE_FRAME_SCALE = 0.26;
const MOTORCYCLE_RIDE_FRAME_INTERVAL_MS = 110;
const MOTORCYCLE_PICKUP_SIZE = { width: 124, height: 78 };
const MOTORCYCLE_RIDE_SIZE = { width: 190, height: 119 };
const MOTORCYCLE_RIDE_DURATION = 10_000;
const MOTORCYCLE_MOUNT_DURATION = 650;
const MOTORCYCLE_SPEED_MULTIPLIER = 1.45;
const ENEMY_FRAME_WIDTH = 81;
const ENEMY_FRAME_HEIGHT = 71;
const ENEMY_TARGET_VISIBLE_HEIGHT = 82;
const ENEMY_VISIBLE_FRAME_HEIGHT = 60;
const ENEMY_KINDS: readonly EnemyKind[] = ["flying-demon"];
const ENEMY_ATTACK_RANGE: Record<EnemyKind, number> = { "flying-demon": 420 };
const ENEMY_MOVE_SPEED: Record<EnemyKind, number> = { "flying-demon": 128 };
const ENEMY_PROJECTILE_TEXTURE = "monster-flying-demon-projectile";
const ENEMY_PROJECTILE_SPEED = 280;
const ENEMY_PROJECTILE_SIZE = { width: 48, height: 32 };

function enemySpriteSize() {
  const height = Math.round(ENEMY_TARGET_VISIBLE_HEIGHT * ENEMY_FRAME_HEIGHT / ENEMY_VISIBLE_FRAME_HEIGHT);
  const width = Math.round(height * ENEMY_FRAME_WIDTH / ENEMY_FRAME_HEIGHT);
  return { width, height };
}

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
  private motorcycles!: Phaser.Physics.Arcade.StaticGroup;
  private readonly hazards: DamageHazard[] = [];
  private readonly generatedSegments: GeneratedSegment[] = [];
  private readonly enemies: EnemyUnit[] = [];
  private readonly enemyProjectiles: EnemyProjectile[] = [];
  private readonly checkpointAltars: Phaser.GameObjects.Sprite[] = [];
  private readonly score: ScoreState = createScoreState();
  private readonly scoreEvents: AttemptEvent[] = [];
  private readonly backgroundLayers: BackgroundLayer[] = [];
  private keys!: Keys;
  private playerArt!: Phaser.GameObjects.Image;
  private motorcycleRideUntil = 0;
  private motorcycleMountUntil = 0;
  private motorcycleAnimationStartedAt = 0;
  private motorcycleWasMoving = false;
  private previous: MobileSnapshot = { left: false, right: false, jump: false, dash: false, attack: false };
  private runStartedAt = 0;
  private checkpointX = 75;
  private checkpointY = PLAYER_START_Y;
  private checkpointCount = 0;
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
  private attackFrameIndex = -1;
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
    this.load.spritesheet(HAZARD_SMOKE_ORB_SHEET, "/obstacles/smoke-orb-sheet.png", { frameWidth: 512, frameHeight: 512 });
    this.load.spritesheet(CHECKPOINT_ALTAR_TEXTURE, "/checkpoints/altar-sheet.png", CHECKPOINT_ALTAR_FRAME_SIZE);
    for (const effect of GAME_EFFECTS) {
      this.load.spritesheet(effect.key, effect.path, { frameWidth: effect.frameWidth, frameHeight: effect.frameHeight });
    }
    for (let index = 0; index < ISLAND_PLATFORMS.length; index += 1) {
      const islandNumber = index === 3 ? 6 : index + 1;
      this.load.image(ISLAND_PLATFORMS[index].key, `/space/island-${islandNumber}.webp`);
    }
    this.load.image(ISLAND_SET_PIECES[0], "/space/island-4.webp");
    this.load.image(ISLAND_SET_PIECES[1], "/space/island-5.webp");
    this.load.image(PICKUP_TEXTURE, "/items/cigarette-pack.webp");
    this.load.image(MOTORCYCLE_TEXTURE, "/vehicles/motorcycle.png");
    this.load.image(ENEMY_PROJECTILE_TEXTURE, "/monsters/flying-demon/projectile.png");
    this.load.image(MOTORCYCLE_MOUNT_TEXTURE, "/vehicles/motorcycle-mount.png");
    this.load.image(MOTORCYCLE_RIDING_TEXTURE, "/vehicles/motorcycle-riding.png");
    MOTORCYCLE_RIDE_FRAME_TEXTURES.forEach((key, index) => {
      this.load.image(key, `/vehicles/riding-frames/moto_quadro_${String(index + 1).padStart(2, "0")}.png`);
    });
    this.load.image(PLAYER_TEXTURES.idle, "/character/01_parado_idle.png");
    this.load.image(PLAYER_TEXTURES.walkOne, "/character/02_andando_passada_1.png");
    this.load.image(PLAYER_TEXTURES.walkTwo, "/character/03_andando_passada_2.png");
    this.load.image(PLAYER_TEXTURES.crouch, "/character/04_agachado.png");
    this.load.image(PLAYER_TEXTURES.jumpRise, "/character/05_pulo_subida.png");
    this.load.image(PLAYER_TEXTURES.jumpAir, "/character/06_pulo_no_ar.png");
    this.load.image(PLAYER_TEXTURES.landing, "/character/07_aterrissagem.png");
    this.load.image(PLAYER_TEXTURES.dash, "/character/08_dash_ataque.png");
    PLAYER_ATTACK_TEXTURES.forEach((key, index) => {
      this.load.image(key, `/character/attacks/punch-${String(index + 1).padStart(2, "0")}.png`);
    });
    for (const kind of ENEMY_KINDS) {
      const root = `/monsters/${kind}`;
      for (const action of ["idle", "move", "attack", "hit", "death"] as const) {
        const assetName = action === "move" ? "flying" : action === "hit" ? "hurt" : action;
        this.load.spritesheet(`monster-${kind}-${action}-sheet`, `${root}/${assetName}.png`, { frameWidth: ENEMY_FRAME_WIDTH, frameHeight: ENEMY_FRAME_HEIGHT });
      }
    }
  }

  create() {
    this.viewWidth = this.scale.gameSize.width;
    this.createEnemyAnimations();
    this.createEffectAnimations();
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, VIEW_HEIGHT + 1_200);
    this.setCameraBounds(WORLD_WIDTH);
    this.cameras.main.setZoom(1);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
    this.drawBackdrop();
    this.addFloatingSetPiece(620, 52, 210, ISLAND_SET_PIECES[0]);
    this.addFloatingSetPiece(1_900, 58, 185, ISLAND_SET_PIECES[1]);
    this.addFloatingSetPiece(3_290, 48, 205, ISLAND_SET_PIECES[0]);

    this.platforms = this.physics.add.staticGroup();
    this.crystals = this.physics.add.staticGroup();
    this.motorcycles = this.physics.add.staticGroup();
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
      for (const hazard of zone.hazards) {
        let x = hazard.x;
        let y = hazard.y;
        const hazardLeft = hazard.x - hazard.width / 2;
        const hazardRight = hazard.x + hazard.width / 2;
        const platform = zone.platforms
          .map((candidate) => {
            const platformLeft = candidate.x - candidate.width / 2;
            const platformRight = candidate.x + candidate.width / 2;
            const gap = Math.max(platformLeft - hazardRight, hazardLeft - platformRight, 0);
            return {
              gap,
              left: platformLeft,
              right: platformRight,
              surfaceY: candidate.y - (candidate.height ?? 60) / 2,
              distanceFromHazard: Math.abs(candidate.y - hazard.y),
            };
          })
          .sort((left, right) => left.gap - right.gap || left.distanceFromHazard - right.distanceFromHazard)[0];
        if (platform?.gap === 0) {
          const orbRadius = (Math.max(hazard.width, hazard.height) + 14) / 2;
          const minX = platform.left + orbRadius;
          const maxX = platform.right - orbRadius;
          x = minX <= maxX ? Phaser.Math.Clamp(hazard.x, minX, maxX) : (platform.left + platform.right) / 2;
          y = platform.surfaceY - hazard.height / 2;
        }
        this.addHazard(x, y, hazard.width, hazard.height);
      }
      for (const enemy of zone.enemies) {
        this.addEnemy(enemy);
      }
      const longPlatform = zone.platforms
        .filter((platform) => platform.width >= 250 && platform.x >= zone.start + 450)
        .sort((left, right) => right.width - left.width)[0];
      if (longPlatform) {
        const height = longPlatform.height ?? 60;
        this.addMotorcyclePickup(longPlatform.x, longPlatform.y - height / 2);
      }
      this.add.text(zone.start + 34, 92, zone.name, { fontFamily: "monospace", fontSize: "18px", color: "#6ff6ff", letterSpacing: 2 })
        .setScrollFactor(1).setDepth(1);
      this.add.rectangle(zone.start, 270, 2, 390, 0x37657c, 0.5);
      this.add.rectangle(zone.end, 270, 2, 390, 0x37657c, 0.5);
      const checkpointPlatform = zone.platforms
        .map((platform) => ({
          left: platform.x - platform.width / 2,
          right: platform.x + platform.width / 2,
          surfaceY: platform.y - (platform.height ?? 60) / 2,
        }))
        .sort((left, right) => {
          const leftGap = Math.max(left.left - zone.checkpoint, zone.checkpoint - left.right, 0);
          const rightGap = Math.max(right.left - zone.checkpoint, zone.checkpoint - right.right, 0);
          return leftGap - rightGap || left.surfaceY - right.surfaceY;
        })[0];
      this.addCheckpoint(zone.checkpoint, checkpointPlatform);
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
    this.physics.add.overlap(this.player, this.motorcycles, (_player, motorcycle) => this.collectMotorcycle(motorcycle as Phaser.GameObjects.Image), undefined, this);
    this.playerArt = this.add.image(PLAYER_START_X, GROUND_TOP, PLAYER_TEXTURES.idle)
      .setOrigin(0.5, 1).setScale(PLAYER_ART_SCALE).setDepth(2);
    this.positionPlayerArt();
    this.cameras.main.startFollow(this.player, true, 1, 0.08, 0, 0);
    this.cameras.main.centerOn(this.player.x, this.cameras.main.midPoint.y);

    this.keys = this.input.keyboard!.addKeys({
      left: "LEFT", right: "RIGHT", jump: "SPACE", dash: "SHIFT", attack: "X",
      a: "A", d: "D", w: "W", z: "Z", up: "UP", down: "DOWN", s: "S", c: "C",
    }) as Keys;
    this.runStartedAt = performance.now();
    this.emitHud();
  }

  private createEnemyAnimations() {
    for (const kind of ENEMY_KINDS) {
      const frameCounts = { idle: 4, move: 4, attack: 8, hit: 4, death: 7 };
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

  private createEffectAnimations() {
    if (!this.anims.exists(CHECKPOINT_ALTAR_ANIMATION)) {
      this.anims.create({
        key: CHECKPOINT_ALTAR_ANIMATION,
        frames: this.anims.generateFrameNumbers(CHECKPOINT_ALTAR_TEXTURE, { start: 0, end: 3 }),
        frameRate: 5,
        repeat: -1,
      });
    }
    for (const effect of GAME_EFFECTS) {
      if (this.anims.exists(effect.key)) continue;
      this.anims.create({
        key: effect.key,
        frames: this.anims.generateFrameNumbers(effect.key, { start: 0, end: effect.frameCount - 1 }),
        frameRate: 15,
        repeat: 0,
      });
    }
    if (!this.anims.exists(CHECKPOINT_GLOW_ANIMATION)) {
      this.anims.create({
        key: CHECKPOINT_GLOW_ANIMATION,
        frames: this.anims.generateFrameNumbers("fx-checkpoint-glow", { start: 0, end: 3 }),
        frameRate: 6,
        repeat: -1,
      });
    }
    if (!this.anims.exists(HAZARD_SMOKE_ORB_ANIMATION)) {
      this.anims.create({
        key: HAZARD_SMOKE_ORB_ANIMATION,
        frames: this.anims.generateFrameNumbers(HAZARD_SMOKE_ORB_SHEET, { start: 0, end: HAZARD_SMOKE_ORB_FRAME_ANCHORS.length - 1 }),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  private playEffect(key: string, x: number, y: number, width: number, height = width, flipX = false) {
    const effect = this.add.sprite(x, y, key)
      .setOrigin(0.5)
      .setDisplaySize(width, height)
      .setDepth(5)
      .setFlipX(flipX);
    effect.play(key);
    effect.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => effect.destroy());
    return effect;
  }

  private addEnemy(spec: EnemySpec, segment?: GeneratedSegment) {
    const minX = spec.minX ?? spec.x - 105;
    const maxX = spec.maxX ?? spec.x + 105;
    const spriteSize = enemySpriteSize();
    const sprite = this.add.sprite(spec.x, spec.y, `monster-${spec.kind}-idle-sheet`)
      .setDisplaySize(spriteSize.width, spriteSize.height)
      .setDepth(2);
    const hitbox = this.add.rectangle(spec.x, spec.y, 56, 48, 0, 0)
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
      direction: -1,
      state: "hover",
      stateUntil: 0,
      impactAt: 0,
      attackHit: false,
      nextAttackAt: this.time.now + 900 + ENEMY_KINDS.indexOf(spec.kind) * 250,
      health: 2,
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
        .setTileScale(Math.max(this.viewWidth / 2_000, VIEW_HEIGHT / 400))
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

  private setCameraBounds(worldRightEdge: number) {
    const left = PLAYER_START_X - this.viewWidth / 2;
    const right = Math.max(worldRightEdge, left + this.viewWidth);
    this.cameras.main.setBounds(left, 0, right - left, VIEW_HEIGHT);
  }

  private handleResize() {
    const width = this.scale.gameSize.width;
    if (!Number.isFinite(width) || width <= 0 || width === this.viewWidth) return;
    this.viewWidth = width;
    const boundsWidth = Math.max(this.worldEndX, width);
    this.physics.world.setBounds(0, 0, boundsWidth, VIEW_HEIGHT + 1_200);
    this.setCameraBounds(this.worldEndX);
    for (const layer of this.backgroundLayers) {
      layer.sprite
        .setPosition(width / 2, VIEW_HEIGHT / 2)
        .setSize(width, VIEW_HEIGHT)
        .setTileScale(Math.max(width / 2_000, VIEW_HEIGHT / 400));
    }
    this.updateBackdrop();
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

  private addHazard(x: number, y: number, width: number, height: number, segment?: GeneratedSegment) {
    const shape = this.add.rectangle(x, y, width, height, 0, 0).setVisible(false);
    const orbSize = Math.max(width, height) + 14;
    const anchor = HAZARD_SMOKE_ORB_FRAME_ANCHORS[0];
    const baseScale = orbSize / 512;
    const visual = this.add.sprite(x, y + height / 2, HAZARD_SMOKE_ORB_SHEET)
      .setDisplaySize(orbSize, orbSize)
      .setDepth(1)
      .setOrigin(anchor.x, anchor.y)
      .setScale(baseScale * 0.22)
      .setAlpha(0)
      .play(HAZARD_SMOKE_ORB_ANIMATION);
    this.tweens.add({
      targets: visual,
      scaleX: { from: baseScale * 0.22, to: baseScale },
      scaleY: { from: baseScale * 0.22, to: baseScale },
      alpha: { from: 0, to: 0.95 },
      duration: 650,
      hold: 750,
      yoyo: true,
      repeat: -1,
      repeatDelay: 1_400,
      delay: 450,
      ease: "Sine.inOut",
    });
    const hazard = { shape, visual };
    this.hazards.push(hazard);
    if (segment) {
      segment.hazards.push(hazard);
      segment.objects.push(shape);
      segment.objects.push(visual);
    }
  }

  private addCheckpoint(x: number, surface: CheckpointSurface, objects?: Phaser.GameObjects.GameObject[]) {
    const inset = CHECKPOINT_ALTAR_DISPLAY_SIZE.width / 2 + 6;
    const minX = surface.left + inset;
    const maxX = surface.right - inset;
    const centerX = minX <= maxX ? Phaser.Math.Clamp(x, minX, maxX) : (surface.left + surface.right) / 2;
    const anchor = CHECKPOINT_ALTAR_FRAME_ANCHORS[0];
    const altar = this.add.sprite(centerX, surface.surfaceY, CHECKPOINT_ALTAR_TEXTURE)
      .setDisplaySize(CHECKPOINT_ALTAR_DISPLAY_SIZE.width, CHECKPOINT_ALTAR_DISPLAY_SIZE.height)
      .setOrigin(anchor.x, anchor.y)
      .setDepth(2)
      .setData("surfaceY", surface.surfaceY);
    altar.on(Phaser.Animations.Events.ANIMATION_UPDATE, (_animation: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame) => {
      const frameAnchor = CHECKPOINT_ALTAR_FRAME_ANCHORS[Number(frame.textureFrame)] ?? anchor;
      altar.setOrigin(frameAnchor.x, frameAnchor.y);
    });
    altar.play(CHECKPOINT_ALTAR_ANIMATION);
    this.checkpointAltars.push(altar);
    objects?.push(altar);
    return altar;
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
      for (const pickup of segment.motorcyclePickups) this.motorcycles.remove(pickup, true, true);
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
      const altarIndex = segment.checkpoint ? this.checkpointAltars.indexOf(segment.checkpoint) : -1;
      if (altarIndex >= 0) this.checkpointAltars.splice(altarIndex, 1);
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
    const widestPlatformWidth = Math.max(...platformWidths);
    const motorcyclePlatformPart = index % 3 === 1 && widestPlatformWidth >= 260
      ? platformWidths.indexOf(widestPlatformWidth)
      : -1;
    const secondHeight = 420 + Math.floor(random() * 61);
    const thirdHeight = Phaser.Math.Clamp(secondHeight + Math.floor(random() * 91) - 45, 420, 480);
    const segment: GeneratedSegment = {
      start,
      end,
      renderEnd: end,
      checkpointX: start + 80,
      platforms: [],
      pickups: [],
      motorcyclePickups: [],
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

      const pickupX = part === motorcyclePlatformPart ? center - width * 0.22 : center;
      const pickup = this.add.image(pickupX, surfaceY - 24, PICKUP_TEXTURE).setDisplaySize(24, 40).setDepth(1);
      pickup.setData("crystalId", `endless-${index}-${part}`);
      this.crystals.add(pickup);
      (pickup.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      this.tweens.add({ targets: pickup, y: surfaceY - 30, duration: 650, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      segment.pickups.push(pickup);

      left += width + gap;
    }

    if (motorcyclePlatformPart >= 0) {
      const platform = platforms[motorcyclePlatformPart];
      this.addMotorcyclePickup(platform.center + platform.width * 0.22, platform.surfaceY, segment);
    }

    const hazardCount = Math.min(3 + Math.floor(index / 2), 6);
    for (let obstacle = 0; obstacle < hazardCount; obstacle += 1) {
      const platformIndex = obstacle % platforms.length;
      if (platformIndex === motorcyclePlatformPart) continue;
      const slot = Math.floor(obstacle / platforms.length);
      const firstSlotSide = platformIndex === 0 ? 1 : -1;
      const side = slot % 2 === 0 ? firstSlotSide : -firstSlotSide;
      const platform = platforms[platformIndex];
      const x = platform.center + side * platform.width * 0.28;
      const surfaceY = platform.surfaceY;
      this.addHazard(x, surfaceY - 15, 42 + Math.min(difficulty * 2, 20), 30, segment);
    }

    const availableEnemyPlatforms = platforms.filter((_platform, part) => part !== motorcyclePlatformPart);
    const enemyPlatforms = availableEnemyPlatforms.length ? availableEnemyPlatforms : platforms;
    const monsterCount = difficulty >= 4 && random() > 0.62 ? 2 : 1;
    for (let encounter = 0; encounter < monsterCount; encounter += 1) {
      const platform = enemyPlatforms[(encounter + Math.floor(random() * enemyPlatforms.length)) % enemyPlatforms.length];
      const kind = ENEMY_KINDS[Math.floor(random() * ENEMY_KINDS.length)];
      const minX = platform.center - platform.width / 2 + 26;
      const maxX = platform.center + platform.width / 2 - 26;
      const spawnX = Phaser.Math.Clamp(platform.center + (random() - 0.5) * Math.max(0, platform.width - 72), minX, maxX);
      const spawnY = Phaser.Math.Clamp(platform.surfaceY - 95, 100, VIEW_HEIGHT - 100);
      this.addEnemy({
        x: spawnX,
        y: spawnY,
        minX,
        maxX,
        kind,
        id: `endless-${index}-monster-${encounter}`,
      }, segment);
    }

    const checkpointPlatform = platforms[0];
    segment.checkpoint = this.addCheckpoint(segment.checkpointX, {
      left: checkpointPlatform.center - checkpointPlatform.width / 2,
      right: checkpointPlatform.center + checkpointPlatform.width / 2,
      surfaceY: checkpointPlatform.surfaceY,
    }, segment.objects);
    this.generatedSegments.push(segment);
    this.worldEndX = end + CHUNK_AHEAD * this.viewWidth;
    this.physics.world.setBounds(0, 0, this.worldEndX, VIEW_HEIGHT + 1_200);
    this.setCameraBounds(this.worldEndX);
  }

  private addMotorcyclePickup(x: number, surfaceY: number, segment?: GeneratedSegment) {
    const pickup = this.add.image(x, surfaceY, MOTORCYCLE_TEXTURE)
      .setOrigin(0.5, 1)
      .setDisplaySize(MOTORCYCLE_PICKUP_SIZE.width, MOTORCYCLE_PICKUP_SIZE.height)
      .setDepth(1);
    this.motorcycles.add(pickup);
    (pickup.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
    segment?.motorcyclePickups.push(pickup);
  }

  private collectMotorcycle(pickup: Phaser.GameObjects.Image) {
    if (this.motorcycleRideUntil > this.time.now || !pickup.active) return;
    this.playEffect("fx-collect-sparkle", pickup.x, pickup.y - 35, 76);
    this.motorcycles.remove(pickup, true, true);
    this.motorcycleRideUntil = this.time.now + MOTORCYCLE_RIDE_DURATION;
    this.motorcycleMountUntil = this.time.now + MOTORCYCLE_MOUNT_DURATION;
    this.motorcycleAnimationStartedAt = this.motorcycleMountUntil;
    this.motorcycleWasMoving = false;
    this.audio.play("motorcycle");
    this.playerArt.setTexture(MOTORCYCLE_MOUNT_TEXTURE)
      .setOrigin(0.5, 1)
      .setDisplaySize(MOTORCYCLE_RIDE_SIZE.width, MOTORCYCLE_RIDE_SIZE.height)
      .setDepth(2);
    this.positionPlayerArt();
  }

  private endMotorcycleRide() {
    if (!this.motorcycleRideUntil) return;
    this.motorcycleRideUntil = 0;
    this.motorcycleMountUntil = 0;
    this.motorcycleAnimationStartedAt = 0;
    this.motorcycleWasMoving = false;
    this.playerArt.setTexture(PLAYER_TEXTURES.idle).setScale(PLAYER_ART_SCALE);
    this.positionPlayerArt();
  }

  private collect(crystal: Phaser.GameObjects.Image) {
    const id = crystal.getData("crystalId") as string | undefined;
    if (!id || !this.award("crystal", `crystal:${id}`)) return;
    this.playEffect("fx-collect-sparkle", crystal.x, crystal.y, 64);
    this.audio.play("crystal");
    this.crystals.remove(crystal, true, true);
    this.emitHud();
  }

  update(time: number, delta: number) {
    if (this.finished || this.respawning) return;
    if (this.motorcycleRideUntil && time >= this.motorcycleRideUntil) this.endMotorcycleRide();
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
    const ridingMotorcycle = this.motorcycleRideUntil > time;
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
      if (direction) this.body.setAccelerationX(direction * PHYSICS.acceleration * (ridingMotorcycle ? MOTORCYCLE_SPEED_MULTIPLIER : 1));
      else this.body.setAccelerationX(0).setDragX(PHYSICS.friction);
      this.body.setMaxVelocityX(PHYSICS.runSpeed * (ridingMotorcycle ? MOTORCYCLE_SPEED_MULTIPLIER : 1));

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
        this.playEffect("fx-dash-smoke", this.player.x - this.facing * 25, this.player.y + 20, 64, 54, this.facing < 0);
        this.audio.play("dash");
      }
    }

    if (justPressed("attack")) this.startAttack(time);
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
    const ridingMotorcycle = time < this.motorcycleRideUntil;
    let motorcycleAnimationFrame = false;
    if (ridingMotorcycle && time < this.motorcycleMountUntil) {
      this.motorcycleWasMoving = false;
      texture = MOTORCYCLE_MOUNT_TEXTURE;
    } else if (ridingMotorcycle && Math.abs(this.body.velocity.x) > 24) {
      if (!this.motorcycleWasMoving) {
        this.motorcycleAnimationStartedAt = time;
        this.motorcycleWasMoving = true;
      }
      const frameIndex = Math.floor((time - this.motorcycleAnimationStartedAt) / MOTORCYCLE_RIDE_FRAME_INTERVAL_MS)
        % MOTORCYCLE_RIDE_FRAME_TEXTURES.length;
      texture = MOTORCYCLE_RIDE_FRAME_TEXTURES[frameIndex];
      motorcycleAnimationFrame = true;
    } else if (ridingMotorcycle) {
      this.motorcycleWasMoving = false;
      texture = MOTORCYCLE_RIDING_TEXTURE;
    } else if (time < this.dashUntil) texture = PLAYER_TEXTURES.dash;
    else if (time < this.attackUntil) {
      texture = PLAYER_ATTACK_TEXTURES[this.attackFrameIndex];
    } else if (grounded && crouching) texture = PLAYER_TEXTURES.crouch;
    else if (grounded && time < this.landingUntil) texture = PLAYER_TEXTURES.landing;
    else if (!grounded) texture = this.body.velocity.y < 0 ? PLAYER_TEXTURES.jumpRise : PLAYER_TEXTURES.jumpAir;
    else if (direction) texture = Math.floor(time / 150) % 2 === 0 ? PLAYER_TEXTURES.walkOne : PLAYER_TEXTURES.walkTwo;

    if (this.playerArt.texture.key !== texture) {
      this.playerArt.setTexture(texture);
      if (motorcycleAnimationFrame) this.playerArt.setScale(MOTORCYCLE_RIDE_FRAME_SCALE);
      else if (ridingMotorcycle) this.playerArt.setDisplaySize(MOTORCYCLE_RIDE_SIZE.width, MOTORCYCLE_RIDE_SIZE.height);
      else {
        const attackFrameIndex = PLAYER_ATTACK_TEXTURES.indexOf(texture as typeof PLAYER_ATTACK_TEXTURES[number]);
        const attackFrameHeight = PLAYER_ATTACK_FRAME_HEIGHTS[attackFrameIndex];
        this.playerArt.setScale(attackFrameHeight ? PLAYER_ART_HEIGHT / attackFrameHeight : PLAYER_ART_SCALE);
      }
    }
    this.positionPlayerArt();
    this.playerArt.setFlipX(this.facing < 0);
    this.playerArt.setAlpha(this.respawning ? 0.55 : 1);
  }

  private positionPlayerArt() {
    const rideFrameIndex = MOTORCYCLE_RIDE_FRAME_TEXTURES.findIndex((key) => key === this.playerArt.texture.key);
    if (rideFrameIndex >= 0) {
      const groundOffset = (MOTORCYCLE_RIDE_FRAME_SOURCE_HEIGHT - MOTORCYCLE_RIDE_FRAME_BASELINES[rideFrameIndex])
        * MOTORCYCLE_RIDE_FRAME_SCALE;
      this.playerArt.setPosition(
        this.player.x,
        this.player.y + PLAYER_ART_FOOT_OFFSET + PLAYER_ART_GROUNDING_OVERLAP + groundOffset,
      );
      this.playerArt.setFlipX(this.facing < 0);
      return;
    }
    if (this.playerArt.texture.key === MOTORCYCLE_MOUNT_TEXTURE || this.playerArt.texture.key === MOTORCYCLE_RIDING_TEXTURE) {
      this.playerArt.setPosition(
        this.player.x,
        this.player.y + PLAYER_ART_FOOT_OFFSET + PLAYER_ART_GROUNDING_OVERLAP,
      );
      this.playerArt.setFlipX(this.facing < 0);
      return;
    }
    const bottomMargin = PLAYER_TEXTURE_BOTTOM_MARGIN[this.playerArt.texture.key] ?? 0;
    const visibleFootOffset = this.playerArt.displayHeight * bottomMargin;
    this.playerArt.setPosition(
      this.player.x,
      this.player.y + PLAYER_ART_FOOT_OFFSET + visibleFootOffset + PLAYER_ART_GROUNDING_OVERLAP,
    );
  }

  private updateHazards(time: number) {
    for (const hazard of this.hazards) {
      const frameIndex = hazard.visual.anims.currentFrame?.index ?? 0;
      const anchor = HAZARD_SMOKE_ORB_FRAME_ANCHORS[frameIndex] ?? HAZARD_SMOKE_ORB_FRAME_ANCHORS[0];
      hazard.visual
        .setPosition(hazard.shape.x, hazard.shape.y + hazard.shape.height / 2)
        .setOrigin(anchor.x, anchor.y);
      const smokeActive = hazard.visual.alpha > 0.25;
      if (smokeActive && time > this.invulnerableUntil && this.rectanglesOverlap(this.player, hazard.shape)) {
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

      const dx = this.player.x - enemy.sprite.x;
      const dy = this.player.y - enemy.hitbox.y;
      const distance = Math.abs(dx);
      const attackRange = ENEMY_ATTACK_RANGE[enemy.kind];
      const verticalRange = 138;
      const canReachPlayer = distance < attackRange + 22 && Math.abs(dy) < verticalRange;

      if (enemy.state === "attack") {
        enemy.direction = dx < 0 ? -1 : 1;
        enemy.sprite.setFlipX(enemy.direction > 0);
        if (!enemy.attackHit && time >= enemy.impactAt) {
          enemy.attackHit = true;
          this.launchEnemyProjectile(enemy, time);
        }
        if (time >= enemy.stateUntil) {
          enemy.state = "approach";
          this.playEnemyAnimation(enemy, "move");
        }
        continue;
      }

      const aggro = distance < 560 && Math.abs(dy) < 240;
      let moving = false;
      const targetX = aggro
        ? Phaser.Math.Clamp(this.player.x - Math.sign(dx || enemy.direction) * 76, enemy.minX, enemy.maxX)
        : enemy.homeX;
      const horizontalStep = targetX - enemy.sprite.x;
      const previousX = enemy.sprite.x;
      if (Math.abs(horizontalStep) > 2) {
        enemy.direction = Math.sign(horizontalStep);
        enemy.sprite.x += enemy.direction * Math.min(Math.abs(horizontalStep), ENEMY_MOVE_SPEED[enemy.kind] * step);
      } else if (aggro) {
        enemy.direction = dx < 0 ? -1 : 1;
      }
      const targetY = aggro
        ? Phaser.Math.Clamp(this.player.y - 52, 90, VIEW_HEIGHT - 90)
        : enemy.baseY + Math.sin(time / 720 + enemy.homeX) * 12;
      const previousY = enemy.sprite.y;
      enemy.sprite.y = Phaser.Math.Linear(enemy.sprite.y, targetY, Math.min(1, step * 2.8));
      enemy.hitbox.setPosition(enemy.sprite.x, enemy.sprite.y);
      moving = Math.abs(enemy.sprite.x - previousX) > 0.1 || Math.abs(enemy.sprite.y - previousY) > 0.1;

      enemy.sprite.setFlipX(enemy.direction > 0);
      if (aggro && canReachPlayer && time >= enemy.nextAttackAt) {
        enemy.direction = dx < 0 ? -1 : 1;
        enemy.state = "attack";
        enemy.stateUntil = time + 920;
        enemy.impactAt = time + 500;
        enemy.attackHit = false;
        enemy.nextAttackAt = time + 2_000;
        enemy.sprite.setFlipX(enemy.direction > 0);
        this.playEnemyAnimation(enemy, "attack");
      } else {
        enemy.state = aggro ? "approach" : "hover";
        this.playEnemyAnimation(enemy, moving ? "move" : "idle");
      }
    }
    this.updateEnemyProjectiles(time, delta);
  }

  private launchEnemyProjectile(enemy: EnemyUnit, time: number) {
    const originX = enemy.sprite.x + enemy.direction * 28;
    const originY = enemy.sprite.y + 2;
    const deltaX = this.player.x - originX;
    const deltaY = this.player.y - originY;
    const distance = Math.max(1, Math.hypot(deltaX, deltaY));
    const velocityX = deltaX / distance * ENEMY_PROJECTILE_SPEED;
    const velocityY = deltaY / distance * ENEMY_PROJECTILE_SPEED;
    const sprite = this.add.image(originX, originY, ENEMY_PROJECTILE_TEXTURE)
      .setDisplaySize(ENEMY_PROJECTILE_SIZE.width, ENEMY_PROJECTILE_SIZE.height)
      .setDepth(4)
      .setRotation(Math.atan2(velocityY, velocityX) - Math.PI);
    this.enemyProjectiles.push({ sprite, velocityX, velocityY, expiresAt: time + 4_000 });
  }

  private updateEnemyProjectiles(time: number, delta: number) {
    const step = Phaser.Math.Clamp(delta, 0, 50) / 1_000;
    for (let index = this.enemyProjectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.enemyProjectiles[index];
      projectile.sprite.x += projectile.velocityX * step;
      projectile.sprite.y += projectile.velocityY * step;
      if (time >= projectile.expiresAt) {
        projectile.sprite.destroy();
        this.enemyProjectiles.splice(index, 1);
        continue;
      }
      if (time >= this.invulnerableUntil
        && Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), projectile.sprite.getBounds())) {
        projectile.sprite.destroy();
        this.enemyProjectiles.splice(index, 1);
        this.playEffect("fx-player-impact", this.player.x, this.player.y, 68);
        this.die();
        return;
      }
    }
  }

  private startAttack(time: number) {
    this.attackFrameIndex = (this.attackFrameIndex + 1) % PLAYER_ATTACK_TEXTURES.length;
    this.attackUntil = time + PLAYER_ATTACK_DURATION_MS;
    this.audio.play("attack");
    for (const enemy of this.enemies) {
      if (!enemy.sprite.active || enemy.state === "dying") continue;
      const dx = enemy.sprite.x - this.player.x;
      const inFront = dx * this.facing >= -8 && Math.abs(dx) < 108;
      const verticalRange = 138;
      if (inFront && Math.abs(enemy.hitbox.y - this.player.y) < verticalRange) this.hitEnemy(enemy, time);
    }
  }

  private hitEnemy(enemy: EnemyUnit, time: number) {
    enemy.health -= 1;
    this.playEffect("fx-attack-impact", enemy.sprite.x - this.facing * 14, enemy.sprite.y, 62, 62, this.facing < 0);
    this.audio.play("hit");
    if (enemy.health > 0) {
      enemy.state = "hit";
      enemy.stateUntil = time + 460;
      enemy.nextAttackAt = Math.max(enemy.nextAttackAt, time + 550);
      this.playEnemyAnimation(enemy, "hit");
      return;
    }
    enemy.state = "dying";
    enemy.stateUntil = time + 800;
    enemy.hitbox.setActive(false);
    this.playEffect("fx-enemy-explosion", enemy.sprite.x, enemy.sprite.y, 80);
    this.playEnemyAnimation(enemy, "death");
    this.award("target", `target:${enemy.id}`);
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
      const altar = this.checkpointAltars[index];
      if (altar && this.player.x >= altar.x && !altar.getData("activated")) {
        this.activateCheckpoint(altar);
        this.audio.play("checkpoint");
        this.emitHud();
      }
    }
    while (this.player.x >= this.nextEndlessCheckpointX) {
      const segment = this.generatedSegments.find((item) => item.checkpointX === this.nextEndlessCheckpointX);
      this.activateCheckpoint(segment?.checkpoint);
      this.nextEndlessCheckpointX += SEGMENT_LENGTH;
      this.audio.play("checkpoint");
      this.emitHud();
    }
  }

  private activateCheckpoint(altar?: Phaser.GameObjects.Sprite) {
    if (!altar?.active) return;
    if (altar.getData("activated")) return;
    altar.setData("activated", true);
    this.checkpointX = altar.x;
    this.checkpointY = Number(altar.getData("surfaceY")) - PLAYER_BODY_HEIGHT / 2;
    this.checkpointCount += 1;

    const glow = this.add.sprite(
      altar.x,
      altar.y - CHECKPOINT_ALTAR_DISPLAY_SIZE.height * 0.44,
      "fx-checkpoint-glow",
    )
      .setDisplaySize(CHECKPOINT_GLOW_DISPLAY_SIZE.width, CHECKPOINT_GLOW_DISPLAY_SIZE.height)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(3)
      .setAlpha(0.9)
      .play(CHECKPOINT_GLOW_ANIMATION);
    altar.setData("checkpointGlow", glow);
    const ownerSegment = this.generatedSegments.find((segment) => segment.checkpoint === altar);
    ownerSegment?.objects.push(glow);
  }

  private die() {
    if (this.respawning || this.finished || performance.now() < this.invulnerableUntil) return;
    for (const projectile of this.enemyProjectiles) projectile.sprite.destroy();
    this.enemyProjectiles.length = 0;
    this.respawning = true;
    this.playEffect("fx-dash-smoke", this.player.x, this.player.y, 66, 58);
    this.endMotorcycleRide();
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
      this.player.setPosition(this.checkpointX, this.checkpointY).setAlpha(1);
      this.cameras.main.centerOn(this.player.x, this.cameras.main.midPoint.y);
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
      checkpoint: this.checkpointCount,
    };
  }

  private emitHud() {
    this.hudAt = this.time.now + 150;
    this.onHud(this.hud());
  }
}
