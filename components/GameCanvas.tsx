"use client";

import { useEffect, useRef } from "react";
import { AudioFeedback } from "@/game/audio";
import { Controls, type Action } from "@/game/controls";
import type { TrialHud, TrialResult } from "@/game/TrialScene";

const BUTTONS: { action: Action; label: string; className: string }[] = [
  { action: "left", label: "◀", className: "move" },
  { action: "right", label: "▶", className: "move" },
  { action: "jump", label: "PULAR", className: "jump" },
  { action: "dash", label: "DASH", className: "dash" },
  { action: "attack", label: "ATQ", className: "attack" },
];

export function GameCanvas({ runId, controls, audio, onHud, onResult }: {
  runId: number;
  controls: Controls;
  audio: AudioFeedback;
  onHud: (hud: TrialHud) => void;
  onResult: (result: TrialResult) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const activePointers = useRef(new Map<number, Action>());

  useEffect(() => {
    let game: { destroy: (removeCanvas: boolean, noReturn?: boolean) => void } | undefined;
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
      const stageRatio = stage && stage.clientHeight > 0 ? stage.clientWidth / stage.clientHeight : 16 / 9;
      const gameWidth = Math.max(320, Math.round(gameHeight * stageRatio));
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        backgroundColor: "#070d19",
        width: gameWidth,
        height: gameHeight,
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: gameWidth,
          height: gameHeight,
        },
        physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false } },
        render: { antialias: true, pixelArt: false, powerPreference: "high-performance" },
        scene: [scene],
      });
    })();
    return () => {
      cancelled = true;
      pointers.clear();
      controls.releaseAll();
      game?.destroy(true);
    };
  }, [runId, controls, audio, onHud, onResult]);

  useEffect(() => {
    const clearInputs = () => {
      controls.releaseAll();
      activePointers.current.clear();
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
  }, [controls]);

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

  return (
    <div className="game-stage" aria-label="Área do jogo. Use as setas ou A e D para mover, espaço para pular, Shift para dash e X para atacar.">
      <div ref={hostRef} className="phaser-host" />
      <div className="touch-controls" aria-label="Controles de toque">
        <div className="touch-group touch-movement">
          {BUTTONS.filter((item) => item.className === "move").map((item) => (
            <button key={item.action} className={`touch-button ${item.className}`} aria-label={item.action === "left" ? "Mover para esquerda" : "Mover para direita"}
              onPointerDown={(event) => press(event, item.action)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="touch-group touch-actions">
          {BUTTONS.filter((item) => item.className !== "move").map((item) => (
            <button key={item.action} className={`touch-button ${item.className}`} aria-label={item.action === "jump" ? "Pular" : item.action === "dash" ? "Dash" : "Atacar"}
              onPointerDown={(event) => press(event, item.action)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
