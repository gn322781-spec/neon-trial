"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Controls } from "@/game/controls";
import { AudioFeedback } from "@/game/audio";
import { GAME_VERSION } from "@/game/rules";
import type { TrialHud, TrialResult } from "@/game/TrialScene";
import { GameCanvas } from "@/components/GameCanvas";
import { getNickname, saveNickname as persistNickname, subscribeNickname } from "@/lib/identity/local-nickname";
import { ApiError, claimRemoteNickname, createRemoteAttempt, fetchRanking, forgetPendingSubmission, rememberPendingSubmission, retryPendingSubmissions, submitRemoteAttempt } from "@/lib/score/client";
import { getSupabaseConfig } from "@/lib/supabase/config";

type Screen = "home" | "game" | "ranking" | "settings" | "result";
const EMPTY_HUD: TrialHud = { score: 0, zone: 1, deaths: 0, lives: 4, distance: 0, dashReady: true, checkpoint: 0 };
type RankRow = { position: number; nickname: string; best_score: number };
const RANKING_NAME_LAYERS = ["Layer_43", "Layer_39", "Layer_35", "Layer_32", "Layer_29", "Layer_26", "Layer_23"];
const RANKING_SCORE_LAYERS = ["Layer_42", "Layer_38", "Layer_34", "Layer_31", "Layer_28", "Layer_25", "Layer_22"];

function updateRankingArtwork(document: Document | null, rows: RankRow[]) {
  if (!document) return;
  const writeText = (layerId: string, value: string, maxWidth?: number) => {
    const text = document.getElementById(layerId)?.querySelector<SVGTextElement>("text");
    if (!text) return;
    text.textContent = value;
    if (maxWidth === undefined || !value) return;
    let measuredWidth: number;
    try {
      measuredWidth = text.getComputedTextLength();
    } catch {
      return;
    }
    if (measuredWidth > maxWidth) {
      text.setAttribute("textLength", String(maxWidth));
      text.setAttribute("lengthAdjust", "spacingAndGlyphs");
    } else {
      text.removeAttribute("textLength");
      text.removeAttribute("lengthAdjust");
    }
  };

  const writeRows = () => {
    RANKING_NAME_LAYERS.forEach((layerId, index) => writeText(layerId, rows[index]?.nickname ?? "", 470));
    RANKING_SCORE_LAYERS.forEach((layerId, index) => writeText(layerId, rows[index]?.best_score.toLocaleString("pt-BR") ?? ""));
  };

  writeRows();
  void document.fonts?.ready.then(writeRows);
}

function validNickname(value: string) {
  const nickname = value.normalize("NFC").trim();
  return nickname.length >= 3 && nickname.length <= 16 && /^[\p{L}\p{N}_]+(?:[ \p{L}\p{N}_]*[\p{L}\p{N}_])?$/u.test(nickname);
}

export function GameShell() {
  const controls = useMemo(() => new Controls(), []);
  const audio = useMemo(() => new AudioFeedback(), []);
  const [screen, setScreen] = useState<Screen>("home");
  const [paused, setPaused] = useState(false);
  const nickname = useSyncExternalStore(subscribeNickname, getNickname, () => "");
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [runId, setRunId] = useState(0);
  const [hud, setHud] = useState(EMPTY_HUD);
  const [result, setResult] = useState<TrialResult | null>(null);
  const [nicknameError, setNicknameError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [attemptStatus, setAttemptStatus] = useState<"local" | "connecting" | "ready">("local");
  const [submissionStatus, setSubmissionStatus] = useState<"idle" | "pending" | "confirmed" | "unavailable" | "failed" | "rejected">("idle");
  const [submissionMessage, setSubmissionMessage] = useState("");
  const [recordUpdated, setRecordUpdated] = useState(false);
  const [volume, setVolume] = useState(audio.volume);
  const [vibration, setVibration] = useState(audio.vibration);
  const [personalRank, setPersonalRank] = useState<RankRow | null>(null);
  const [rankRows, setRankRows] = useState<RankRow[]>([]);
  const [rankStatus, setRankStatus] = useState<"idle" | "loading" | "loading-more" | "loaded" | "empty" | "error">("idle");
  const [rankError, setRankError] = useState("");
  const [rankPage, setRankPage] = useState(0);
  const [rankDisplayedPage, setRankDisplayedPage] = useState(0);
  const [rankHasMore, setRankHasMore] = useState(false);
  const [rankReload, setRankReload] = useState(0);
  const rankingSvgRef = useRef<HTMLObjectElement>(null);
  const attemptRef = useRef<Promise<{ id: string; token: string } | null>>(Promise.resolve(null));

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const retryPending = () => { void retryPendingSubmissions(); };
    const onPendingSynced = (event: Event) => {
      const detail = (event as CustomEvent<{ attemptId?: string; response?: Record<string, unknown> }>).detail;
      void attemptRef.current.then((attempt) => {
        if (!attempt || attempt.id !== detail?.attemptId) return;
        const updated = detail.response?.recordUpdated === true;
        setSubmissionStatus("confirmed");
        setRecordUpdated(updated);
        setSubmissionMessage(updated ? "Novo recorde confirmado pelo servidor após a reconexão." : "Resultado confirmado pelo servidor após a reconexão.");
      });
    };
    retryPending();
    window.addEventListener("online", retryPending);
    window.addEventListener("neon-trial-pending-synced", onPendingSynced);
    return () => {
      window.removeEventListener("online", retryPending);
      window.removeEventListener("neon-trial-pending-synced", onPendingSynced);
    };
  }, []);

  const submitRun = useCallback(async (next: TrialResult) => {
    setSubmissionStatus("pending");
    setSubmissionMessage("Enviando e validando a tentativa…");
    setRecordUpdated(false);
    if (!getSupabaseConfig()) {
      setSubmissionStatus("unavailable");
      setSubmissionMessage("O servidor ainda não está configurado. Esta pontuação continua local e não é um recorde confirmado.");
      return;
    }
    let currentAttemptId: string | null = null;
    try {
      const attempt = await attemptRef.current;
      if (!attempt) {
        setSubmissionStatus("unavailable");
        setSubmissionMessage("Não foi possível abrir uma tentativa autenticada. A pontuação ficou somente neste navegador.");
        return;
      }
      currentAttemptId = attempt.id;
      const response = await submitRemoteAttempt(attempt.id, attempt.token, next);
      forgetPendingSubmission(attempt.id);
      setSubmissionStatus("confirmed");
      setRecordUpdated(response.recordUpdated === true);
      setSubmissionMessage(response.recordUpdated === true
        ? `Novo recorde confirmado pelo servidor. Sua posição atual é ${String(response.position ?? "—")}.`
        : `Resultado confirmado pelo servidor. Seu melhor registro continua em ${Number(response.bestScore ?? 0).toLocaleString("pt-BR")} pontos.`);
    } catch (error) {
      setSubmissionStatus(error instanceof ApiError && error.status === 409 ? "rejected" : "failed");
      if (currentAttemptId && !(error instanceof ApiError && error.status === 409)) rememberPendingSubmission(currentAttemptId, next);
      setSubmissionMessage(error instanceof ApiError && error.code === "nickname_taken"
        ? "Este apelido já está vinculado a outra identidade. Escolha outro antes da próxima tentativa."
        : error instanceof ApiError && error.status === 409
          ? "O servidor rejeitou esta tentativa como duplicada ou inválida; ela não alterou o ranking."
          : "A conexão falhou antes da confirmação. Esta pontuação ainda não está salva no ranking; tente enviar novamente.");
    }
  }, []);

  const onHud = useCallback((next: TrialHud) => setHud(next), []);
  const onResult = useCallback((next: TrialResult) => {
    setResult(next);
    setPaused(false);
    setScreen("result");
    void submitRun(next);
  }, [submitRun]);

  useEffect(() => {
    if (screen !== "ranking") return;
    let active = true;
    void fetchRanking(rankPage).then((data) => {
      if (!active) return;
      setRankRows(data.items);
      setRankDisplayedPage(rankPage);
      setPersonalRank(data.me);
      setRankHasMore(data.hasMore);
      setRankError("");
      setRankStatus(rankPage === 0 && data.items.length === 0 ? "empty" : "loaded");
    }).catch((error: unknown) => {
      if (!active) return;
      setRankError(error instanceof ApiError && error.code === "supabase_unconfigured"
        ? "O Supabase ainda não está configurado. Os recordes não são guardados localmente."
        : "Não foi possível carregar o ranking agora.");
      setRankStatus("error");
    });
    return () => { active = false; };
  }, [screen, rankPage, rankReload]);

  useEffect(() => {
    if (screen === "ranking") updateRankingArtwork(rankingSvgRef.current?.contentDocument ?? null, rankRows);
  }, [screen, rankRows]);

  const openRanking = () => {
    setRankRows([]);
    setPersonalRank(null);
    setRankPage(0);
    setRankDisplayedPage(0);
    setRankStatus("loading");
    setRankError("");
    setRankReload((current) => current + 1);
    setScreen("ranking");
  };

  useEffect(() => {
    if (screen !== "game") return;
    const onPauseKey = (event: KeyboardEvent) => {
      if (event.code !== "Escape") return;
      event.preventDefault();
      setPaused((current) => !current);
    };
    window.addEventListener("keydown", onPauseKey);
    return () => window.removeEventListener("keydown", onPauseKey);
  }, [screen]);

  const start = async (nicknameForRun = nickname, localOnly = false) => {
    if (!nicknameForRun) {
      setNicknameDraft("");
      setNicknameError("Escolha um apelido para iniciar sua primeira tentativa.");
      setScreen("settings");
      return;
    }
    controls.releaseAll();
    setPaused(false);
    setResult(null);
    setHud(EMPTY_HUD);
    setSubmissionStatus("idle");
    setSubmissionMessage("");
    setRecordUpdated(false);
    if (!localOnly && getSupabaseConfig()) {
      setAttemptStatus("connecting");
      attemptRef.current = createRemoteAttempt(nicknameForRun, GAME_VERSION).catch(() => null);
      void attemptRef.current.then((attempt) => setAttemptStatus(attempt ? "ready" : "local"));
    } else {
      attemptRef.current = Promise.resolve(null);
      setAttemptStatus("local");
    }
    setRunId((current) => current + 1);
    setScreen("game");
    void audio.unlock().catch(() => undefined);
    try {
      const orientation = window.screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
      await orientation.lock?.("landscape");
    } catch {
      // Landscape is requested only where the browser allows it; CSS gives a clear fallback.
    }
  };

  const saveNickname = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validNickname(nicknameDraft)) {
      setNicknameError("Use 3 a 16 caracteres: letras, números, espaços e sublinhado.");
      return;
    }
    const clean = nicknameDraft.normalize("NFC").trim().replace(/\s+/g, " ");
    setNicknameError("");
    setProfileNotice("");
    setProfileSaving(true);
    try {
      const claimed = await claimRemoteNickname(clean);
      persistNickname(claimed ?? clean);
      setNicknameDraft(claimed ?? clean);
      setProfileNotice(claimed
        ? "Apelido validado e reservado para sua identidade anônima no servidor."
        : "Apelido salvo somente neste navegador. Configure o Supabase para validar e reservar o nome no ranking.");
      void start(claimed ?? clean);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setNicknameError("Este apelido já está em uso. Escolha outro para continuar.");
      } else if (error instanceof ApiError && error.code === "invalid_nickname") {
        setNicknameError("O servidor recusou este apelido. Use outro de 3 a 16 caracteres.");
      } else {
        persistNickname(clean);
        setNicknameDraft(clean);
        const errorCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
        setProfileNotice(errorCode === "anonymous_provider_disabled"
          ? "O login anônimo do Supabase está desativado. Apelido salvo localmente; o ranking online ainda não está disponível."
          : "O servidor demorou para responder. Apelido salvo localmente; o ranking online ainda não está disponível.");
        void start(clean, true);
      }
    } finally {
      setProfileSaving(false);
    }
  };

  if (screen === "game") {
    return (
      <main className={`play-screen${paused ? " is-paused" : ""}`}>
        <section className="game-frame" aria-label="Partida em andamento">
          <div className="game-topbar">
            <button type="button" className="hud-icon-button" onClick={() => { controls.releaseAll(); setPaused(false); setScreen("home"); }} aria-label="Voltar ao menu"><img src="/ui/basic-gui/Icons/Icon_Small_WhiteOutline_Home.png" alt="" draggable={false} /></button>
            <div className="hud-stat"><span><img src="/ui/basic-gui/Icons/Icon_Small_WhiteOutline_Star.png" alt="" draggable={false} />PONTOS</span><strong>{hud.score.toLocaleString("pt-BR")}</strong></div>
            <div className="hud-stat"><span><img src="/ui/basic-gui/Icons/Icon_Small_WhiteOutline_Arrow.png" alt="" draggable={false} />SETOR</span><strong>{String(hud.zone).padStart(2, "0")}</strong></div>
            <div className="hud-stat checkpoint-hud"><span><img src="/ui/basic-gui/Icons/Icon_Small_WhiteOutline_Check.png" alt="" draggable={false} />CHECKPOINT</span><strong>{String(hud.checkpoint).padStart(2, "0")}</strong></div>
            <div className="hud-stat"><span>QUEDAS</span><strong>{hud.deaths}</strong></div>
            <div className="lives-hud" role="img" aria-label={`Vidas restantes: ${hud.lives} de 4`} title={`Vidas: ${hud.lives} de 4`}>
              {Array.from({ length: 4 }, (_, index) => <img key={index} className={`life-heart-img ${index < hud.lives ? "active" : "lost"}`} src={`/ui/basic-gui/Icons/Icon_Large_Heart${index < hud.lives ? "Full" : "Empty"}.png`} alt="" aria-hidden="true" draggable={false} />)}
            </div>
            <div className={`dash-state ${hud.dashReady ? "ready" : ""}`}><span className="dash-led" /> DASH {hud.dashReady ? "OK" : "RECARREGANDO"}</div>
            <span className={`attempt-state ${attemptStatus}`}>{attemptStatus === "ready" ? "TENTATIVA VINCULADA" : attemptStatus === "connecting" ? "CONECTANDO" : "MODO LOCAL"}</span>
            <button type="button" className="hud-icon-button pause-trigger" onClick={() => setPaused(true)} aria-label="Pausar partida"><img src="/ui/basic-gui/Icons/Icon_Small_WhiteOutline_Pause.png" alt="" draggable={false} /></button>
          </div>
          <GameCanvas runId={runId} controls={controls} audio={audio} onHud={onHud} onResult={onResult} paused={paused} />
          {paused && <div className="pause-overlay">
            <section className="pause-card gui-panel" role="dialog" aria-modal="true" aria-labelledby="pause-title">
              <span className="gui-kicker"><img src="/ui/basic-gui/Icons/Icon_Small_WhiteOutline_Pause.png" alt="" draggable={false} /> PARTIDA INTERROMPIDA</span>
              <h1 id="pause-title">PAUSA</h1>
              <p>Respire. O percurso espera por você.</p>
              <div className="pause-actions">
                <button type="button" className="primary-button" onClick={() => setPaused(false)}>CONTINUAR</button>
                <button type="button" className="secondary-button" onClick={() => void start()}>RECOMEÇAR</button>
                <button type="button" className="secondary-button pause-exit" onClick={() => { controls.releaseAll(); setPaused(false); setScreen("home"); }}>SAIR PARA O MENU</button>
              </div>
              <small>ESC PARA CONTINUAR</small>
            </section>
          </div>}
          <div className="game-hint"><span>← → ANDAR</span><span>↓ AGACHAR</span><span>ESPAÇO PULAR</span><span>SHIFT DASH</span><span>X SOCAR</span><span>ESC PAUSA</span></div>
        </section>
        <div className="portrait-message"><span>↻</span><strong>Gire o aparelho</strong><small>NEON TRIAL foi projetado para jogar na horizontal.</small></div>
      </main>
    );
  }

  if (screen === "ranking") {
    return (
      <main className="shell interior-screen ranking-screen">
        <header className="subpage-head"><button className="text-button" onClick={() => setScreen("home")}>← MENU</button><span className="eyebrow">CLASSIFICAÇÃO GLOBAL</span></header>
        <section className="ranking-card">
          <div className="ranking-board">
            <object ref={rankingSvgRef} className="ranking-board-art" data="/ranking-board.svg" type="image/svg+xml" aria-hidden="true" onLoad={() => updateRankingArtwork(rankingSvgRef.current?.contentDocument ?? null, rankRows)} />
            <ol className="ranking-board-accessible" aria-label="Pontuações do ranking">
              {rankRows.map((row) => <li key={`${row.position}:${row.nickname}`}>{row.position}. {row.nickname}: {row.best_score.toLocaleString("pt-BR")} pontos</li>)}
            </ol>
            {rankRows.length > 0 && <nav className="ranking-pages" aria-label="Páginas do ranking">
              {[-1, 0, 1].map((offset) => {
                const page = rankDisplayedPage + offset;
                const disabled = page < 0 || page > rankDisplayedPage && !rankHasMore || rankStatus === "loading-more" || rankStatus === "loading";
                return <button key={offset} type="button" aria-label={page < 0 ? "Sem página anterior" : `Página ${page + 1}`} aria-current={page === rankDisplayedPage ? "page" : undefined} disabled={disabled} onClick={() => {
                  if (disabled || page === rankDisplayedPage) return;
                  setRankStatus("loading-more");
                  setRankPage(page);
                }} />;
              })}
            </nav>}
          </div>
          {rankStatus === "loading" && <p className="ranking-message" role="status">BUSCANDO RECORDES CONFIRMADOS…</p>}
          {rankStatus === "loading-more" && <p className="ranking-message" role="status">CARREGANDO PÁGINA {String(rankPage + 1).padStart(2, "0")}…</p>}
          {rankStatus === "error" && <div className="ranking-message ranking-error" role="alert"><span>{rankError}</span><button type="button" onClick={() => { setRankStatus("loading-more"); setRankReload((current) => current + 1); }}>TENTAR NOVAMENTE</button></div>}
          {rankStatus === "empty" && <p className="ranking-message">AINDA NÃO HÁ RECORDES. CONCLUA UMA PARTIDA PARA DISPUTAR A PRIMEIRA POSIÇÃO.</p>}
          {personalRank && <div className="ranking-personal"><span>SEU MELHOR</span><strong>{personalRank.best_score.toLocaleString("pt-BR")}</strong><b>#{personalRank.position} · {personalRank.nickname}</b></div>}
          <div className="ranking-footer"><span>IDENTIDADE: {nickname || "NÃO DEFINIDA"}</span><span>PÁGINA {String(rankDisplayedPage + 1).padStart(2, "0")} · VERSION {GAME_VERSION.toUpperCase()}</span></div>
        </section>
      </main>
    );
  }

  if (screen === "settings") {
    return (
      <main className="shell interior-screen settings-screen">
        <header className="subpage-head"><button className="text-button gui-back-link" onClick={() => setScreen("home")}><img src="/ui/basic-gui/Icons/Icon_Small_WhiteOutline_Return.png" alt="" draggable={false} /> VOLTAR AO MENU</button><span className="eyebrow">PREFERÊNCIAS</span></header>
        <section className="settings-card gui-panel"><span className="eyebrow">SEU PILOTO</span><h1>IDENTIDADE</h1>
          <form className="nickname-form" onSubmit={saveNickname}>
            <label htmlFor="nickname">Apelido público</label><input id="nickname" value={nicknameDraft} maxLength={16} onChange={(event) => setNicknameDraft(event.target.value)} placeholder="Ex.: Neon Runner" />
            {nicknameError && <p className="form-error">{nicknameError}</p>}
            {profileNotice && <p className="profile-notice">{profileNotice}</p>}
            <p className="form-note">O apelido público não precisa ser seu nome real. Sem credenciais do Supabase, ele permanece local e não fica reservado no ranking.</p>
            <button className="primary-button compact" type="submit" disabled={profileSaving}>{profileSaving ? "VALIDANDO…" : "SALVAR APELIDO"} <span>↗</span></button>
          </form>
          <div className="audio-settings"><label htmlFor="volume"><span className="setting-label"><img src={`/ui/basic-gui/Icons/Icon_Small_WhiteOutline_${volume > 0 ? "Audio" : "AudioOff"}.png`} alt="" draggable={false} /> Efeitos sonoros</span><b>{Math.round(volume * 100)}%</b></label><input id="volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); audio.setVolume(next); }} /><label className="vibration-setting"><input type="checkbox" checked={vibration} onChange={(event) => { const next = event.target.checked; setVibration(next); audio.setVibration(next); }} /> Vibração nos momentos importantes, quando suportada</label></div>
          <div className="settings-note"><strong>COMO JOGAR</strong><p>Teclado: setas ou A/D para andar, ↓/S para agachar, Espaço para pular, Shift para dash e X para socar. No celular, use o analógico e os botões nas laterais; os comandos aceitam multitoque.</p></div>
        </section>
      </main>
    );
  }

  if (screen === "result" && result) {
    return (
      <main className="shell interior-screen result-screen">
        <section className="result-card gui-panel"><span className="eyebrow">PARTIDA ENCERRADA</span><h1>FIM DE<br /><em>JOGO.</em></h1>
          <div className="result-score"><span>PONTUAÇÃO DA TENTATIVA</span><strong>{result.score.toLocaleString("pt-BR")}</strong></div>
          <div className="result-meta"><span>SETOR <b>{String(result.zone).padStart(2, "0")}</b></span><span>VIDAS <b>{result.lives} / 4</b></span><span>TEMPO <b>{(result.elapsedMs / 1_000).toFixed(1)}s</b></span></div>
          <p className={`pending-banner ${submissionStatus}`}>{submissionStatus === "confirmed" && recordUpdated ? "NOVO RECORDE" : submissionStatus === "confirmed" ? "RESULTADO CONFIRMADO" : submissionStatus === "pending" ? "VALIDANDO" : submissionStatus === "rejected" ? "TENTATIVA RECUSADA" : "PONTUAÇÃO NÃO CONFIRMADA"} — {submissionMessage || "Aguardando o servidor."}</p>
          <div className="result-actions"><button className="primary-button" onClick={() => void start()}>NOVA PARTIDA <span>↗</span></button>{submissionStatus === "failed" && <button className="secondary-button" onClick={() => void submitRun(result)}>TENTAR ENVIAR</button>}<button className="secondary-button" onClick={openRanking}>VER RANKING</button><button className="text-button" onClick={() => setScreen("home")}>VOLTAR AO MENU</button></div>
        </section>
      </main>
    );
  }

  return (
    <main className="shell home-screen">
      <div className="home-grid" />
      <header className="topbar"><a className="wordmark" href="#top" onClick={(event) => event.preventDefault()}><span className="wordmark-icon">N</span> NEON<span>TRIAL</span></a><button className="text-button settings-link" onClick={() => { setNicknameDraft(nickname); setScreen("settings"); }}><img src="/ui/basic-gui/Icons/Icon_Small_WhiteOutline_Menu.png" alt="" draggable={false} /> CONFIGURAÇÕES <span>↗</span></button></header>
      <section className="hero" id="top">
        <div className="hero-copy gui-panel"><span className="eyebrow"><span className="live-dot" /> PLATAFORMA DE PRECISÃO / VERSÃO 0.2</span><h1>MAIS UMA<br /><em>TENTATIVA.</em></h1><p>Salte, acerte o tempo e aprenda o percurso.<br />A aventura é infinita. Você tem quatro vidas.</p>
          <div className="hero-actions"><button className="primary-button" onClick={() => void start()}>COMEÇAR PARTIDA</button><button className="secondary-button" onClick={openRanking}><img src="/ui/basic-gui/Icons/Icon_Small_WhiteOutline_Star.png" alt="" draggable={false} /> RANKING GLOBAL</button></div>
          <div className="pilot-line"><span className="avatar">{nickname ? nickname.slice(0, 1).toUpperCase() : "?"}</span><span><small>PILOTO</small><strong>{nickname || "Escolha um apelido"}</strong></span><button className="edit-name" onClick={() => { setNicknameDraft(nickname); setScreen("settings"); }}>EDITAR ↗</button></div>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="orbit orbit-a"/><div className="orbit orbit-b"/><div className="art-platform platform-a"/><div className="art-platform platform-b"/><div className="art-platform platform-c"/><div className="art-player"/><div className="art-crystal crystal-a"/><div className="art-crystal crystal-b"/><div className="art-scanline"/><span className="art-coordinate">CIDADE NEON / ∞</span><span className="art-axis">CORRER — PULAR — REPETIR</span></div>
      </section>
      <section className="feature-strip"><div><span>01</span><strong>PRECISÃO</strong><small>Tempo certo para pular e atacar</small></div><div><span>02</span><strong>PERCURSO INFINITO</strong><small>Novos desafios a cada setor</small></div><div><span>03</span><strong>SEU MELHOR</strong><small>Compare sua pontuação no ranking</small></div></section>
      <footer className="home-footer"><span>© NEON TRIAL / {GAME_VERSION.toUpperCase()}</span><span>UMA TENTATIVA DE CADA VEZ</span><span className="connection-state"><i /> LOCAL / SERVIDOR OFFLINE</span><span className="effects-credit">EFEITOS: SUPER PIXEL EFFECTS GIGAPACK · WILL TICE / UNTIED GAMES</span></footer>
    </main>
  );
}
