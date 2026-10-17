"use client";

import { useCallback, useEffect, useRef } from "react";
import { AudioFeedback } from "@/game/audio";
import { Controls, type Action } from "@/game/controls";
import type { TrialHud, TrialResult } from "@/game/TrialScene";

const BUTTONS: { action: Action; label: string; className: string; icon?: string }[] = [
  { action: "jump", label: "PULAR", className: "jump", icon: "cross" },
  { action: "dash", label: "DASH", className: "dash", icon: "triangle" },
  { action: "attack", label: "ATQ", className: "attack", icon: "square" },
];

type PhaserGameHandle = {
  destroy: (removeCanvas: boolean, noReturn?: boolean) => void;
  scale: { setGameSize: (width: number, height: number) => unknown };
  scene: { pause: (key: string) => unknown; resume: (key: string) => unknown };
};

export function GameCanvas({ runId, controls, audio, onHud, onResult, paused = false }: {
  runId: number;
  controls: Controls;
  audio: AudioFeedback;
  onHud: (hud: TrialHud) => void;
  onResult: (result: TrialResult) => void;
  paused?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<PhaserGameHandle | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const activePointers = useRef(new Map<number, Action>());
  const joystickRef = useRef<HTMLButtonElement>(null);
  const joystickPointerId = useRef<number | null>(null);
  const resetJoystick = useCallback(() => {
    joystickPointerId.current = null;
    controls.release("touch:joystick");
    joystickRef.current?.style.setProperty("--stick-x", "0px");
    joystickRef.current?.style.setProperty("--stick-y", "0px");
  }, [controls]);

  useEffect(() => {
    let game: PhaserGameHandle | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let scheduleResize: (() => void) | undefined;
    let resizeFrame = 0;
    let cancelled = false;
    const pointers = activePointers.current;
    void (async () => {
      const PhaserModule = await import("phaser");
      const { TrialScene } = await import("@/game/TrialScene");
      if (cancelled || !hostRef.current) return;
      const Phaser = PhaserModule;
      const scene = new TrialScene(controls, audio, onHud, onResult);
      const stage = hostRef.current.parentElement;
      const gameHeight = 540;
      const measureGameSize = () => {
        const stageWidth = stage?.clientWidth ?? 0;
        const stageHeight = stage?.clientHeight ?? 0;
        if (stageWidth <= 0 || stageHeight <= 0) return null;
        return { width: Math.max(320, Math.round(gameHeight * stageWidth / stageHeight)), height: gameHeight };
      };
      const initialSize = measureGameSize() ?? { width: Math.round(gameHeight * 16 / 9), height: gameHeight };
      let currentWidth = initialSize.width;
      const instance = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        backgroundColor: "#070d19",
        width: initialSize.width,
        height: gameHeight,
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: initialSize.width,
          height: gameHeight,
        },
        physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false } },
        render: { antialias: true, pixelArt: false, powerPreference: "high-performance" },
        scene: [scene],
      });
      game = instance;
      gameRef.current = instance;
      if (pausedRef.current) instance.scene.pause("TrialScene");
      const resizeGame = () => {
        resizeFrame = 0;
        if (!game) return;
        const nextSize = measureGameSize();
        if (!nextSize || nextSize.width === currentWidth) return;
        currentWidth = nextSize.width;
        game.scale.setGameSize(nextSize.width, nextSize.height);
      };
      const onResize = () => {
        if (resizeFrame) return;
        resizeFrame = window.requestAnimationFrame(resizeGame);
      };
      scheduleResize = onResize;
      if (stage && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(onResize);
        resizeObserver.observe(stage);
      }
      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", onResize);
    })();
    return () => {
      cancelled = true;
      pointers.clear();
      resetJoystick();
      controls.releaseAll();
      resizeObserver?.disconnect();
      if (scheduleResize) {
        window.removeEventListener("resize", scheduleResize);
        window.removeEventListener("orientationchange", scheduleResize);
      }
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      if (gameRef.current === game) gameRef.current = null;
      game?.destroy(true);
    };
  }, [runId, controls, audio, onHud, onResult, resetJoystick]);

  useEffect(() => {
    if (paused) {
      controls.releaseAll();
      activePointers.current.clear();
      resetJoystick();
      gameRef.current?.scene.pause("TrialScene");
      return;
    }
    gameRef.current?.scene.resume("TrialScene");
  }, [paused, controls, resetJoystick]);

  useEffect(() => {
    const clearInputs = () => {
      controls.releaseAll();
      activePointers.current.clear();
      resetJoystick();
    };
    const onVisibility = () => { if (document.hidden) clearInputs(); };
    window.addEventListener("blur", clearInputs);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("orientationchange", clearInputs);
    return () => {
      window.removeEventListener("blur", clearInputs);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("orientationchange", clearInputs);
    };
  }, [controls, resetJoystick]);

  const press = (event: React.PointerEvent<HTMLButtonElement>, action: Action) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointers.current.set(event.pointerId, action);
    controls.press(`touch:${event.pointerId}`, action);
  };
  const release = (event: React.PointerEvent<HTMLButtonElement>) => {
    const action = activePointers.current.get(event.pointerId);
    if (!action) return;
    activePointers.current.delete(event.pointerId);
    controls.release(`touch:${event.pointerId}`);
  };
  const updateJoystick = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (joystickPointerId.current !== event.pointerId) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const travel = bounds.width * 0.16;
    const rawX = event.clientX - (bounds.left + bounds.width / 2);
    const rawY = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > travel ? travel / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    event.currentTarget.style.setProperty("--stick-x", `${x}px`);
    event.currentTarget.style.setProperty("--stick-y", `${y}px`);

    controls.release("touch:joystick");
    const horizontal = x / travel;
    if (horizontal <= -0.28) controls.press("touch:joystick", "left");
    else if (horizontal >= 0.28) controls.press("touch:joystick", "right");
  };
  const pressJoystick = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (joystickPointerId.current !== null) return;
    event.preventDefault();
    joystickPointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateJoystick(event);
  };
  const releaseJoystick = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (joystickPointerId.current !== event.pointerId) return;
    resetJoystick();
  };

  return (
    <div className="game-stage" aria-label="Área do jogo. Use o analógico ou A e D para mover, espaço para pular, Shift para dash e X para atacar.">
      <div ref={hostRef} className="phaser-host" />
      <div className="touch-controls" aria-label="Controles de toque">
        <div className="touch-group touch-movement">
          <button ref={joystickRef} className="touch-stick" type="button" aria-label="Analógico para andar"
            onPointerDown={pressJoystick} onPointerMove={updateJoystick} onPointerUp={releaseJoystick}
            onPointerCancel={releaseJoystick} onLostPointerCapture={releaseJoystick}>
            <img src="/ui/buttons/analogue-blank.svg" alt="" draggable={false} />
            <span className="touch-stick-knob" aria-hidden="true" />
          </button>
        </div>
        <div className="touch-group touch-actions">
          {BUTTONS.map((item) => (
            <button key={item.action} className={`touch-button ${item.className} icon-control`} aria-label={item.action === "jump" ? "Pular" : item.action === "dash" ? "Dash" : "Atacar"}
              onPointerDown={(event) => press(event, item.action)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
              {item.icon && <span className="touch-icon" aria-hidden="true">
                <img src={`/ui/buttons/${item.icon}-1.png`} alt="" draggable={false} />
                <img src={`/ui/buttons/${item.icon}-2.png`} alt="" draggable={false} />
              </span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

