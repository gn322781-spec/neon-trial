import * as Phaser from "phaser";
import { AudioFeedback } from "@/game/audio";
import { Controls } from "@/game/controls";
import { PHYSICS, jumpVelocityAfterRelease } from "@/game/physics";
import { awardScore, createScoreState, GAME_VERSION, STARTING_LIVES, SURVIVAL_SCORE_PER_SECOND, type ScoreEvent, type ScoreState } from "@/game/rules";
import { ZONES } from "@/game/zones";

export type TrialHud = { score: number; zone: number; deaths: number; lives: number; distance: number; dashReady: boolean; checkpoint: number };
export type AttemptEvent = { event: ScoreEvent; key: string; at_ms: number; x: number };
export type TrialResult = TrialHud & { completed: true; elapsedMs: number; gameVersion: string; events: AttemptEvent[]; zonesCompleted: number };

type MobileSnapshot = ReturnType<Controls["snapshot"]>;
type DamageHazard = { shape: Phaser.GameObjects.Rectangle; ring?: Phaser.GameObjects.Arc; baseX: number; moving: boolean; phase: number; kind: string; period: number; amplitude: number };
type Target = Phaser.GameObjects.Rectangle & { targetId: string; activeTarget: boolean };
type GeneratedSegment = {
  start: number;
  end: number;
  renderEnd: number;
  checkpointX: number;
  checkpoint?: Phaser.GameObjects.Triangle;
  platforms: Phaser.GameObjects.Rectangle[];
  objects: Phaser.GameObjects.GameObject[];
  hazards: DamageHazard[];
};
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
const SCENERY_TEXTURE = "neon-trial-city";
const PICKUP_TEXTURE = "cigarette-pack";
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
  private readonly targets: Target[] = [];
  private readonly checkpointFlags: Phaser.GameObjects.Triangle[] = [];
  private readonly score: ScoreState = createScoreState();
  private readonly scoreEvents: AttemptEvent[] = [];
  private keys!: Keys;
  private playerArt!: Phaser.GameObjects.Image;
  private previous: MobileSnapshot = { left: false, right: false, jump: false, dash: false, attack: false };
  private runStartedAt = 0;
  private checkpointX = 75;
  private nextEndlessCheckpointX = WORLD_WIDTH + 80;
  private generatedChunkCount = 0;
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

  constructor(controls: Controls, audio: AudioFeedback, onHud: (hud: TrialHud) => void, onResult: (result: TrialResult) => void) {
    super({ key: "TrialScene" });
    this.controls = controls;
    this.audio = audio;
    this.onHud = onHud;
    this.onResult = onResult;
  }

  preload() {
    this.load.image(SCENERY_TEXTURE, "/background/neon-trial-city.webp");
    this.load.image(PICKUP_TEXTURE, "/items/cigarette-pack.webp");
    this.load.image(PLAYER_TEXTURES.idle, "/character/01_parado_idle.png");
    this.load.image(PLAYER_TEXTURES.walkOne, "/character/02_andando_passada_1.png");
    this.load.image(PLAYER_TEXTURES.walkTwo, "/character/03_andando_passada_2.png");
    this.load.image(PLAYER_TEXTURES.crouch, "/character/04_agachado.png");
    this.load.image(PLAYER_TEXTURES.jumpRise, "/character/05_pulo_subida.png");
    this.load.image(PLAYER_TEXTURES.jumpAir, "/character/06_pulo_no_ar.png");
    this.load.image(PLAYER_TEXTURES.landing, "/character/07_aterrissagem.png");
    this.load.image(PLAYER_TEXTURES.dash, "/character/08_dash_ataque.png");
  }

  create() {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, VIEW_HEIGHT + 1_200);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, VIEW_HEIGHT);
    this.cameras.main.setZoom(1);
    this.drawBackdrop();

    this.platforms = this.physics.add.staticGroup();
    this.crystals = this.physics.add.staticGroup();
    for (const zone of ZONES) {
      for (const platform of zone.platforms) {
        const height = platform.height ?? 60;
        const tile = this.add.rectangle(platform.x, platform.y, platform.width, height, 0x102134, 1)
          .setStrokeStyle(2, 0x1ee7ff, 0.8);
        this.platforms.add(tile);
        const body = tile.body as Phaser.Physics.Arcade.StaticBody;
        body.updateFromGameObject();
        this.add.rectangle(platform.x, platform.y - height / 2, platform.width, 4, 0x28f0ff, 0.8);
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
        const target = this.add.rectangle(enemy.x, enemy.y, 30, 38, 0xff477e).setStrokeStyle(2, 0xffb5cb) as Target;
        target.targetId = enemy.id;
        target.activeTarget = true;
        this.targets.push(target);
      }
      this.add.text(zone.start + 34, 50, zone.name, { fontFamily: "monospace", fontSize: "18px", color: "#6ff6ff", letterSpacing: 2 })
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
    this.cameras.main.startFollow(this.player, true, 0.1, 0.08, -250, 0);
    this.cameras.main.setDeadzone(300, 130);

    this.keys = this.input.keyboard!.addKeys({
      left: "LEFT", right: "RIGHT", jump: "SPACE", dash: "SHIFT", attack: "X",
      a: "A", d: "D", w: "W", z: "Z", up: "UP", down: "DOWN", s: "S", c: "C",
    }) as Keys;
    this.runStartedAt = performance.now();
    this.emitHud();
  }

  private drawBackdrop() {
    this.add.image(WORLD_WIDTH / 2, VIEW_HEIGHT / 2, SCENERY_TEXTURE)
      .setDisplaySize(WORLD_WIDTH, VIEW_HEIGHT)
      .setDepth(-10);
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
    while (this.player.x + CHUNK_AHEAD * VIEW_WIDTH >= WORLD_WIDTH + this.generatedChunkCount * SEGMENT_LENGTH) {
      this.addEndlessSegment(this.generatedChunkCount);
      this.generatedChunkCount += 1;
    }

    const cameraLeft = this.cameras.main.worldView.x;
    for (let index = this.generatedSegments.length - 1; index >= 0; index -= 1) {
      const segment = this.generatedSegments[index];
      if (segment.end >= this.checkpointX - SEGMENT_LENGTH || segment.renderEnd >= cameraLeft - 200) continue;
      for (const platform of segment.platforms) this.platforms.remove(platform, true, true);
      for (const hazard of segment.hazards) {
        const hazardIndex = this.hazards.indexOf(hazard);
        if (hazardIndex >= 0) this.hazards.splice(hazardIndex, 1);
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
    const gap = Math.min(55 + difficulty * 8, 115);
    const platformWidth = (SEGMENT_LENGTH - 40 - gap * 2) / 3;
    const segment: GeneratedSegment = {
      start,
      end,
      renderEnd: end,
      checkpointX: start + 80,
      platforms: [],
      objects: [],
      hazards: [],
    };

    if (index % 4 === 0) {
      const panoramaIndex = Math.floor(index / 4);
      const panoramaStart = WORLD_WIDTH + panoramaIndex * WORLD_WIDTH;
      const backdrop = this.add.image(panoramaStart + WORLD_WIDTH / 2, VIEW_HEIGHT / 2, SCENERY_TEXTURE)
        .setDisplaySize(WORLD_WIDTH, VIEW_HEIGHT)
        .setDepth(-10);
      segment.objects.push(backdrop);
      segment.renderEnd = panoramaStart + WORLD_WIDTH;
    }

    const centers: number[] = [];
    let left = start + 20;
    for (let part = 0; part < 3; part += 1) {
      const center = left + platformWidth / 2;
      centers.push(center);
      const platform = this.add.rectangle(center, 510, platformWidth, 60, 0x102134, 1)
        .setStrokeStyle(2, 0x1ee7ff, 0.88);
      this.platforms.add(platform);
      (platform.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      const glow = this.add.rectangle(center, 480, platformWidth, 4, 0x28f0ff, 0.85);
      segment.platforms.push(platform);
      segment.objects.push(platform, glow);
      left += platformWidth + gap;
    }

    const hazardCount = Math.min(1 + Math.floor(index / 2), 6);
    for (let obstacle = 0; obstacle < hazardCount; obstacle += 1) {
      const platformIndex = obstacle % centers.length;
      const slot = Math.floor(obstacle / centers.length);
      const x = centers[platformIndex] + (slot % 2 === 0 ? -1 : 1) * platformWidth * 0.18;
      const kind = difficulty >= 5 && obstacle % 3 === 2 ? "laser" : difficulty >= 2 && obstacle % 2 === 1 ? "saw" : "spike";
      this.addHazard(x, kind === "laser" ? 425 : 465, kind === "laser" ? 14 : 42 + Math.min(difficulty * 2, 20), kind === "laser" ? 110 : 30, kind, segment, difficulty);
    }

    segment.checkpoint = this.addCheckpoint(segment.checkpointX, segment.objects);
    this.generatedSegments.push(segment);
    this.worldEndX = end + CHUNK_AHEAD * VIEW_WIDTH;
    this.physics.world.setBounds(0, 0, this.worldEndX, VIEW_HEIGHT + 1_200);
    this.cameras.main.setBounds(0, 0, this.worldEndX, VIEW_HEIGHT);
  }

  private collect(crystal: Phaser.GameObjects.Image) {
    const id = crystal.getData("crystalId") as string | undefined;
    if (!id || !this.award("crystal", `crystal:${id}`)) return;
    this.audio.play("crystal");
    crystal.destroy();
    this.emitHud();
  }

  update(time: number) {
    if (this.finished || this.respawning) return;
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
    this.updateTargets();
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
    this.playerArt.setPosition(this.player.x, this.player.y + PLAYER_ART_FOOT_OFFSET).setFlipX(this.facing < 0);
    this.playerArt.setAlpha(this.respawning ? 0.55 : 1);
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

  private updateTargets() {
    for (const target of this.targets) {
      if (target.activeTarget && this.rectanglesOverlap(this.player, target)) this.die();
    }
  }

  private startAttack(time: number) {
    this.attackUntil = time + 180;
    this.audio.play("attack");
    this.attackVisual?.destroy();
    this.attackVisual = this.add.rectangle(this.player.x + this.facing * 28, this.player.y, 48, 34, 0x88f7ff, 0.3)
      .setStrokeStyle(2, 0x9fffff).setDepth(2);
    for (const target of this.targets) {
      if (!target.activeTarget) continue;
      const inFront = (target.x - this.player.x) * this.facing >= -4 && Math.abs(target.y - this.player.y) < 58 && Math.abs(target.x - this.player.x) < 72;
      if (inFront) {
        target.activeTarget = false;
        target.destroy();
        this.award("target", `target:${target.targetId}`);
        this.audio.play("hit");
      }
    }
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
      this.playerArt.setPosition(this.player.x, this.player.y + PLAYER_ART_FOOT_OFFSET).setTexture(PLAYER_TEXTURES.idle).setAlpha(1);
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
