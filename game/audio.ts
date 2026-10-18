export type SoundCue = "jump" | "dash" | "attack" | "shoot" | "rooster" | "crystal" | "motorcycle" | "hit" | "death" | "checkpoint" | "zone" | "complete";

const CUES: Record<SoundCue, { frequency: number; duration: number; wave: OscillatorType; volume: number }> = {
  jump: { frequency: 430, duration: 0.085, wave: "square", volume: 0.055 },
  dash: { frequency: 185, duration: 0.14, wave: "sawtooth", volume: 0.065 },
  attack: { frequency: 275, duration: 0.065, wave: "triangle", volume: 0.05 },
  shoot: { frequency: 680, duration: 0.075, wave: "sawtooth", volume: 0.055 },
  rooster: { frequency: 820, duration: 0.12, wave: "triangle", volume: 0.055 },
  crystal: { frequency: 760, duration: 0.11, wave: "sine", volume: 0.07 },
  motorcycle: { frequency: 220, duration: 0.24, wave: "sawtooth", volume: 0.07 },
  hit: { frequency: 165, duration: 0.14, wave: "square", volume: 0.06 },
  death: { frequency: 92, duration: 0.24, wave: "triangle", volume: 0.075 },
  checkpoint: { frequency: 620, duration: 0.16, wave: "sine", volume: 0.06 },
  zone: { frequency: 520, duration: 0.19, wave: "triangle", volume: 0.055 },
  complete: { frequency: 880, duration: 0.28, wave: "sine", volume: 0.075 },
};

export class AudioFeedback {
  private context: AudioContext | null = null;
  private deathAudio: HTMLAudioElement | null = null;
  private motorcycleAudio: HTMLAudioElement | null = null;
  private readonly roosterAudios: HTMLAudioElement[] = [];
  private roosterAudioIndex = 0;
  private currentVolume = 0.65;
  private vibrationOn = false;

  constructor() {
    if (typeof window !== "undefined") {
      const storedVolume = window.localStorage.getItem("neon-trial-volume");
      const volume = storedVolume === null ? Number.NaN : Number(storedVolume);
      if (Number.isFinite(volume) && volume >= 0 && volume <= 1) this.currentVolume = volume;
      this.vibrationOn = window.localStorage.getItem("neon-trial-vibration") === "true";
    }
  }

  get volume() { return this.currentVolume; }
  get vibration() { return this.vibrationOn; }

  setVolume(value: number) {
    this.currentVolume = Math.max(0, Math.min(1, value));
    if (this.deathAudio) this.deathAudio.volume = this.currentVolume;
    if (this.motorcycleAudio) this.motorcycleAudio.volume = this.currentVolume;
    for (const audio of this.roosterAudios) audio.volume = this.currentVolume;
    if (typeof window !== "undefined") window.localStorage.setItem("neon-trial-volume", String(this.currentVolume));
  }

  setVibration(value: boolean) {
    this.vibrationOn = value;
    if (typeof window !== "undefined") window.localStorage.setItem("neon-trial-vibration", String(value));
  }

  async unlock() {
    if (typeof window === "undefined") return;
    this.ensureDeathAudio();
    this.ensureRoosterAudio();
    const Context = window.AudioContext;
    if (!Context) return;
    this.context ??= new Context();
    if (this.context.state === "suspended") await this.context.resume();
  }

  play(cue: SoundCue) {
    if (cue === "rooster") {
      const audio = this.ensureRoosterAudio();
      if (audio && this.currentVolume > 0) {
        audio.volume = this.currentVolume;
        try {
          audio.currentTime = 0;
          void audio.play().catch(() => this.playTone("rooster"));
        } catch {
          this.playTone("rooster");
        }
        return;
      }
    }
    if (cue === "motorcycle") {
      const audio = this.ensureMotorcycleAudio();
      if (audio && this.currentVolume > 0) {
        audio.volume = this.currentVolume;
        try {
          audio.currentTime = 0;
          void audio.play().catch(() => this.playTone("motorcycle"));
        } catch {
          this.playTone("motorcycle");
        }
        return;
      }
    }
    if (cue === "death") {
      const audio = this.ensureDeathAudio();
      if (audio && this.currentVolume > 0) {
        audio.volume = this.currentVolume;
        try {
          audio.currentTime = 0;
          void audio.play().catch(() => this.playTone("death"));
        } catch {
          this.playTone("death");
        }
        return;
      }
    }
    this.playTone(cue);
  }

  private ensureDeathAudio() {
    if (typeof window === "undefined") return null;
    if (this.deathAudio) return this.deathAudio;

    const audio = new window.Audio();
    if (!audio.canPlayType('audio/ogg; codecs="opus"')) return null;
    audio.src = "/sounds/morri_3.ogg";
    audio.preload = "auto";
    audio.load();
    this.deathAudio = audio;
    return audio;
  }

  private ensureMotorcycleAudio() {
    if (typeof window === "undefined") return null;
    if (this.motorcycleAudio) return this.motorcycleAudio;

    const audio = new window.Audio("/sounds/motorcycle-pickup.mp3");
    audio.preload = "auto";
    audio.load();
    this.motorcycleAudio = audio;
    return audio;
  }

  private ensureRoosterAudio() {
    if (typeof window === "undefined") return null;
    if (this.roosterAudios.length === 0) {
      for (let index = 0; index < 3; index += 1) {
        const audio = new window.Audio("/sounds/rooster-throw.mp3");
        audio.preload = "auto";
        audio.load();
        this.roosterAudios.push(audio);
      }
    }
    // Allow consecutive throws to play without cutting off the previous call.
    return this.roosterAudios.find((audio) => audio.paused || audio.ended)
      ?? this.roosterAudios[this.roosterAudioIndex++ % this.roosterAudios.length];
  }

  private playTone(cue: SoundCue) {
    if (!this.context || this.context.state !== "running" || this.currentVolume <= 0) return;
    const setting = CUES[cue];
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = setting.wave;
    oscillator.frequency.setValueAtTime(setting.frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(45, setting.frequency * (cue === "dash" || cue === "death" ? 0.55 : 1.25)), now + setting.duration);
    gain.gain.setValueAtTime(setting.volume * this.currentVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + setting.duration);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + setting.duration);
  }

  haptic(pattern: number | number[]) {
    if (this.vibrationOn && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  }
}
