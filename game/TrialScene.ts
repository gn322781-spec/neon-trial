import * as Phaser from "phaser";
import { AudioFeedback } from "@/game/audio";
import { Controls } from "@/game/controls";
import { PHYSICS, jumpVelocityAfterRelease } from "@/game/physics";
import { awardScore, createScoreState, GAME_VERSION, type ScoreEvent, type ScoreState } from "@/game/rules";
import { ZONES } from "@/game/zones";

export type TrialHud = { score: number; zone: number; deaths: number; dashReady: boolean; checkpoint: number };
export type AttemptEvent = { event: ScoreEvent; key: string; at_ms: number; x: number };
export type TrialResult = TrialHud & { completed: true; elapsedMs: number; gameVersion: string; events: AttemptEvent[]; zonesCompleted: number };

type MobileSnapshot = ReturnType<Controls["snapshot"]>;
type DamageHazard = { shape: Phaser.GameObjects.Rectangle; ring?: Phaser.GameObjects.Arc; baseX: number; moving: boolean; phase: number; kind: string };
type Target = Phaser.GameObjects.Rectangle & { targetId: string; activeTarget: boolean };
type Keys = {
  left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key; jump: Phaser.Input.Keyboard.Key;
  dash: Phaser.Input.Keyboard.Key; attack: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key; w: Phaser.Input.Keyboard.Key; z: Phaser.Input.Keyboard.Key;
  up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; s: Phaser.Input.Keyboard.Key; c: Phaser.Input.Keyboard.Key;
};

const WORLD_WIDTH = 4_200;
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 540;
const PLAYER_ART_SCALE = 0.22;
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
  private readonly targets: Target[] = [];
  private readonly checkpointFlags: Phaser.GameObjects.Triangle[] = [];
  private readonly score: ScoreState = createScoreState();
  private readonly scoreEvents: AttemptEvent[] = [];
  private keys!: Keys;
  private playerArt!: Phaser.GameObjects.Image;
  private previous: MobileSnapshot = { left: false, right: false, jump: false, dash: false, attack: false };
  private runStartedAt = 0;
  private checkpointX = 75;
  private deaths = 0;
  private coyoteUntil = 0;
  private jumpBufferUntil = 0;
  private dashUntil = 0;
  private nextDashAt = 0;
  private invulnerableUntil = 0;
  private facing = 1;
  private currentZone = 0;
  private hudAt = 0;
  private respawning = false;
  private finished = false;
  private attackUntil = 0;
  private attackVisual?: Phaser.GameObjects.Rectangle;
  private finishLine!: Phaser.GameObjects.Rectangle;
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
        const tile = this.add.rectangle(platform.x, platform.y, platform.width, height, 0x102134, 0.24)
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

    this.finishLine = this.add.rectangle(4_130, 390, 8, 210, 0x7c4dff).setStrokeStyle(2, 0xb89bff);
    this.add.text(4_080, 260, "FINISH", { fontFamily: "monospace", fontSize: "18px", color: "#c6b2ff" });
    this.player = this.add.rectangle(75, 458, 28, 40, 0xf3fbff, 0).setVisible(false);
    this.physics.add.existing(this.player);
    this.body = this.player.body as Phaser.Physics.Arcade.Body;
    this.body.setSize(22, 36);
    this.body.setCollideWorldBounds(true);
    this.body.setGravityY(PHYSICS.gravity);
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.overlap(this.player, this.crystals, (_player, crystal) => this.collect(crystal as Phaser.GameObjects.Image), undefined, this);
    this.playerArt = this.add.image(75, 476, PLAYER_TEXTURES.idle)
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

  private addHazard(x: number, y: number, width: number, height: number, kind: string) {
    const color = kind === "laser" ? 0xff326f : kind === "saw" ? 0xffa648 : 0xff3968;
    const shape = this.add.rectangle(x, y, width, height, color, kind === "laser" ? 0.72 : 0.95)
      .setStrokeStyle(2, kind === "laser" ? 0xffa2c0 : 0xffd0db);
    const ring = kind === "saw" ? this.add.circle(x, y, Math.min(width, height) / 2 + 5, 0x39172a).setStrokeStyle(2, 0xff7853) : undefined;
    this.hazards.push({ shape, ring, baseX: x, moving: kind === "saw", phase: x / 155, kind });
  }

  private addCheckpoint(x: number) {
    this.add.rectangle(x, 425, 8, 100, 0x243448).setStrokeStyle(2, 0x8c69ff, 0.8);
    const flag = this.add.triangle(x + 13, 385, 0, 0, 25, 12, 0, 24, 0x725cff).setOrigin(0, 0.5);
    this.checkpointFlags.push(flag);
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
    this.updateTargets();
    this.updateProgress();
    if (this.player.x >= this.finishLine.x) this.complete();
    if (this.player.y > VIEW_HEIGHT + 60) this.die();

    const current = this.player.x < 1_000 ? 0 : this.player.x < 2_000 ? 1 : this.player.x < 3_000 ? 2 : 3;
    this.currentZone = current;
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
    this.playerArt.setPosition(this.player.x, this.player.y + 18).setFlipX(this.facing < 0);
    this.playerArt.setAlpha(this.respawning ? 0.55 : 1);
  }

  private updateHazards(time: number) {
    for (const hazard of this.hazards) {
      if (hazard.moving) hazard.shape.x = hazard.baseX + Math.sin(time / 420 + hazard.phase) * 75;
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
    this.time.delayedCall(420, () => {
      this.player.setPosition(this.checkpointX, 458).setAlpha(1);
      this.body.setVelocity(0, 0);
      this.body.setAllowGravity(true);
      this.playerArt.setPosition(this.player.x, this.player.y + 18).setTexture(PLAYER_TEXTURES.idle).setAlpha(1);
      this.invulnerableUntil = this.time.now + 1_050;
      this.nextDashAt = this.time.now;
      this.respawning = false;
      this.emitHud();
    });
  }

  private complete() {
    if (this.finished) return;
    this.finished = true;
    this.audio.play("complete");
    this.audio.haptic([35, 35, 80]);
    this.award("zone", "zone:3");
    this.award("finish", "finish:complete");
    this.physics.pause();
    this.controls.releaseAll();
    this.onResult({ ...this.hud(), completed: true, elapsedMs: Math.max(0, Math.round(performance.now() - this.runStartedAt)), gameVersion: GAME_VERSION, events: [...this.scoreEvents], zonesCompleted: 4 });
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
    return {
      score: this.score.value,
      zone: this.currentZone + 1,
      deaths: this.deaths,
      dashReady: this.time.now >= this.nextDashAt,
      checkpoint: ZONES.filter((zone) => zone.checkpoint <= this.checkpointX).length,
    };
  }

  private emitHud() {
    this.hudAt = this.time.now + 150;
    this.onHud(this.hud());
  }
}

