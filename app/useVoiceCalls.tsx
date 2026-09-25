"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient, User } from "@supabase/supabase-js";

type Signal = {
  kind: "invite" | "answer" | "candidate" | "end" | "reject" | "busy";
  id: string;
  from: string;
  to: string;
  device: string;
  name?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type CallView = {
  stage: "incoming" | "calling" | "connecting" | "active";
  name: string;
  room: string;
  muted: boolean;
  startedAt?: number;
};

type Session = {
  id: string;
  roomId: string;
  target: string;
  offer?: RTCSessionDescriptionInit;
  peer?: RTCPeerConnection;
  stream?: MediaStream;
  pendingIce: RTCIceCandidateInit[];
  outgoingIce: RTCIceCandidateInit[];
  canSendIce: boolean;
  timer?: ReturnType<typeof setTimeout>;
  inviteTimer?: ReturnType<typeof setInterval>;
  answerTimer?: ReturnType<typeof setInterval>;
  processingAnswer?: boolean;
};

const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

function PhoneIcon({ crossed = false }: { crossed?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.2 3.8 8.4 3l2.2 4.2-2 2.1c1.2 2.5 3.2 4.4 5.8 5.8l2.1-2 4.2 2.2-.8 3.2c-.3 1.1-1.4 1.8-2.5 1.7C10.1 19.4 4.6 13.9 3.5 6.3c-.1-1.1.6-2.2 1.7-2.5Z" />
      {crossed && <path d="M4 20 20 4" />}
    </svg>
  );
}

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" />
      {muted && <path d="M3 21 21 3" />}
    </svg>
  );
}

function elapsed(startedAt?: number): string {
  if (!startedAt) return "00:00";
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function useVoiceCalls(client: SupabaseClient | null, user: User | null, roomId: string | null, roomTitle?: string) {
  const [view, setView] = useState<CallView | null>(null);
  const [notice, setNotice] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [needsPlay, setNeedsPlay] = useState(false);
  const channelsRef = useRef(new Map<string, RealtimeChannel>());
  const readyRef = useRef(new Set<string>());
  const roomsRef = useRef(new Map<string, string>());
  const sessionRef = useRef<Session | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const ringingRef = useRef<{ context: AudioContext; timer: ReturnType<typeof setInterval> } | null>(null);
  const startingRef = useRef(false);
  const deviceRef = useRef("");
  const handlerRef = useRef<(room: string, signal: Signal) => void>(() => {});

  const attachAudio = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    if (node && remoteStreamRef.current && node.srcObject !== remoteStreamRef.current) {
      node.srcObject = remoteStreamRef.current;
      void node.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true));
    }
  }, []);

  if (typeof window !== "undefined" && !deviceRef.current) deviceRef.current = crypto.randomUUID();

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? "" : current), 5500);
  }

  async function send(room: string, signal: Omit<Signal, "from" | "device">): Promise<boolean> {
    const channel = channelsRef.current.get(room);
    if (!channel || !readyRef.current.has(room) || !user) return false;
    const result = await channel.send({ type: "broadcast", event: "voice_call", payload: { ...signal, from: user.id, device: deviceRef.current } });
    return result === "ok";
  }

  function stopRinging() {
    const ringing = ringingRef.current;
    ringingRef.current = null;
    if (!ringing) return;
    clearInterval(ringing.timer);
    void ringing.context.close().catch(() => {});
  }

  function startRinging() {
    stopRinging();
    try {
      const context = new AudioContext();
      const beep = () => {
        if (context.state !== "running") return;
        for (const offset of [0, 0.25]) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = 620;
          gain.gain.setValueAtTime(0.0001, context.currentTime + offset);
          gain.gain.exponentialRampToValueAtTime(0.09, context.currentTime + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.19);
          oscillator.connect(gain).connect(context.destination);
          oscillator.start(context.currentTime + offset);
          oscillator.stop(context.currentTime + offset + 0.2);
        }
      };
      void context.resume().then(beep).catch(() => {});
      ringingRef.current = { context, timer: setInterval(beep, 2200) };
    } catch { /* navegador bloqueou áudio automático */ }
  }

  function stopSession(tellOther: boolean, message?: string) {
    stopRinging();
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      if (tellOther) void send(session.roomId, { kind: "end", id: session.id, to: session.target });
      if (session.timer) clearTimeout(session.timer);
      if (session.inviteTimer) clearInterval(session.inviteTimer);
      if (session.answerTimer) clearInterval(session.answerTimer);
      session.peer?.close();
      session.stream?.getTracks().forEach((track) => track.stop());
    }
    if (audioRef.current) audioRef.current.srcObject = null;
    remoteStreamRef.current = null;
    document.title = "nosso bloco";
    setView(null);
    setNeedsPlay(false);
    if (message) showNotice(message);
  }

  function subscribeRoom(id: string) {
    if (!client || channelsRef.current.has(id)) return;
    const channel = client.channel(`call:${id}`, { config: { private: true, broadcast: { self: false, ack: true } } });
    channelsRef.current.set(id, channel);
    channel.on("broadcast", { event: "voice_call" }, ({ payload }) => handlerRef.current(id, payload as Signal));
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") readyRef.current.add(id);
      else readyRef.current.delete(id);
    });
  }

  useEffect(() => {
    if (!client || !user) return;
    let alive = true;
    void client.from("chat_rooms").select("id,title").then(({ data }) => {
      if (!alive || !data) return;
      for (const room of data) {
        roomsRef.current.set(room.id, room.title);
        subscribeRoom(room.id);
      }
    });
    return () => {
      alive = false;
      stopSession(false);
      for (const channel of channelsRef.current.values()) void client.removeChannel(channel);
      channelsRef.current.clear();
      readyRef.current.clear();
      roomsRef.current.clear();
    };
    // A assinatura acompanha a conta; mudar de sala não interrompe a chamada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, user?.id]);

  useEffect(() => {
    if (!client || !user || !roomId) return;
    if (roomTitle) roomsRef.current.set(roomId, roomTitle);
    subscribeRoom(roomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, user?.id, roomId, roomTitle]);

  useEffect(() => {
    if (!view?.startedAt) return;
    const timer = window.setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, [view?.startedAt]);

  async function addPendingIce(session: Session) {
    const candidates = session.pendingIce.splice(0);
    for (const candidate of candidates) {
      try { await session.peer?.addIceCandidate(candidate); } catch { /* par remoto pode ter encerrado */ }
    }
  }

  async function flushOutgoingIce(session: Session) {
    session.canSendIce = true;
    for (const candidate of session.outgoingIce) {
      if (sessionRef.current !== session) return;
      await send(session.roomId, { kind: "candidate", id: session.id, to: session.target, candidate });
    }
  }

  function makePeer(session: Session): RTCPeerConnection {
    const peer = new RTCPeerConnection({ iceServers });
    session.peer = peer;
    peer.onicecandidate = ({ candidate }) => {
      if (!candidate || sessionRef.current !== session) return;
      const ice = candidate.toJSON();
      session.outgoingIce.push(ice);
      if (session.canSendIce) void send(session.roomId, { kind: "candidate", id: session.id, to: session.target, candidate: ice });
    };
    peer.ontrack = ({ streams, track }) => {
      remoteStreamRef.current = streams[0] || new MediaStream([track]);
      const audio = audioRef.current;
      if (!audio) return;
      audio.srcObject = remoteStreamRef.current;
      void audio.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true));
    };
    peer.onconnectionstatechange = () => {
      if (sessionRef.current !== session) return;
      if (peer.connectionState === "connected") {
        if (session.timer) clearTimeout(session.timer);
        if (session.answerTimer) clearInterval(session.answerTimer);
        setView((current) => current ? { ...current, stage: "active", startedAt: current.startedAt || Date.now() } : current);
      } else if (peer.connectionState === "failed") {
        stopSession(true, "A ligação caiu. Tente novamente.");
      }
    };
    return peer;
  }

  function armTimeout(session: Session) {
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      if (sessionRef.current === session) stopSession(true, "Ninguém atendeu a ligação.");
    }, 45000);
  }

  async function startVoiceCall() {
    if (!client || !user || !roomId || sessionRef.current || startingRef.current) return;
    startingRef.current = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
        showNotice("Este navegador não permite ligação por voz.");
        return;
      }
      subscribeRoom(roomId);
      for (let attempt = 0; attempt < 50 && !readyRef.current.has(roomId); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!readyRef.current.has(roomId)) {
        showNotice("Conectando à sala. Tente de novo em instantes.");
        return;
      }
      const { data, error } = await client.from("room_members").select("user_id,display_name").eq("room_id", roomId).neq("user_id", user.id);
      if (error || data?.length !== 1) {
        showNotice("A ligação precisa de duas pessoas nesta sala.");
        return;
      }
      if (sessionRef.current) return;
      const other = data[0];
      const session: Session = { id: crypto.randomUUID(), roomId, target: other.user_id, pendingIce: [], outgoingIce: [], canSendIce: false };
      sessionRef.current = session;
      setView({ stage: "calling", name: other.display_name, room: roomTitle || roomsRef.current.get(roomId) || "Sala", muted: false });
      try {
        session.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        if (sessionRef.current !== session) { session.stream.getTracks().forEach((track) => track.stop()); return; }
        const peer = makePeer(session);
        session.stream.getTracks().forEach((track) => peer.addTrack(track, session.stream!));
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        const sent = await send(roomId, { kind: "invite", id: session.id, to: session.target, name: (user.user_metadata?.display_name as string | undefined) || "Alguém", sdp: peer.localDescription?.toJSON() });
        if (!sent) throw new Error("signal");
        session.inviteTimer = setInterval(() => {
          if (sessionRef.current !== session || session.peer?.remoteDescription) return;
          void send(roomId, { kind: "invite", id: session.id, to: session.target, name: (user.user_metadata?.display_name as string | undefined) || "Alguém", sdp: peer.localDescription?.toJSON() });
          for (const candidate of session.outgoingIce) void send(roomId, { kind: "candidate", id: session.id, to: session.target, candidate });
        }, 2000);
        await flushOutgoingIce(session);
        armTimeout(session);
      } catch {
        if (sessionRef.current === session) stopSession(false, "Não foi possível iniciar. Confira o microfone e tente novamente.");
      }
    } finally { startingRef.current = false; }
  }

  async function acceptCall() {
    const session = sessionRef.current;
    if (!session?.offer || !user) return;
    stopRinging();
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      stopSession(true, "Este navegador não permite ligação por voz.");
      return;
    }
    setView((current) => current ? { ...current, stage: "connecting" } : current);
    try {
      session.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (sessionRef.current !== session) { session.stream.getTracks().forEach((track) => track.stop()); return; }
      const peer = makePeer(session);
      session.stream.getTracks().forEach((track) => peer.addTrack(track, session.stream!));
      await peer.setRemoteDescription(session.offer);
      await addPendingIce(session);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      const sent = await send(session.roomId, { kind: "answer", id: session.id, to: session.target, sdp: peer.localDescription?.toJSON() });
      if (!sent) throw new Error("signal");
      session.answerTimer = setInterval(() => {
        if (sessionRef.current !== session || peer.connectionState === "connected") return;
        void send(session.roomId, { kind: "answer", id: session.id, to: session.target, sdp: peer.localDescription?.toJSON() });
        for (const candidate of session.outgoingIce) void send(session.roomId, { kind: "candidate", id: session.id, to: session.target, candidate });
      }, 2000);
      await flushOutgoingIce(session);
      armTimeout(session);
    } catch {
      if (sessionRef.current === session) stopSession(true, "Não foi possível conectar. Confira o microfone.");
    }
  }

  async function onSignal(room: string, signal: Signal) {
    if (!user || !signal || signal.to !== user.id || signal.from === user.id || !signal.id || !signal.from) return;
    if (signal.kind === "invite") {
      if (!signal.sdp || signal.sdp.type !== "offer") return;
      if (sessionRef.current) {
        if (sessionRef.current.id === signal.id && sessionRef.current.target === signal.from) return;
        void send(room, { kind: "busy", id: signal.id, to: signal.from });
        return;
      }
      const session: Session = { id: signal.id, roomId: room, target: signal.from, offer: signal.sdp, pendingIce: [], outgoingIce: [], canSendIce: false };
      sessionRef.current = session;
      setView({ stage: "incoming", name: signal.name || "Alguém", room: roomsRef.current.get(room) || "Sala", muted: false });
      startRinging();
      armTimeout(session);
      if (document.hidden) document.title = "Ligação recebida · nosso bloco";
      return;
    }
    const session = sessionRef.current;
    if (!session || session.id !== signal.id || session.roomId !== room || session.target !== signal.from) return;
    if (signal.kind === "candidate" && signal.candidate) {
      if (!session.peer?.remoteDescription) session.pendingIce.push(signal.candidate);
      else try { await session.peer.addIceCandidate(signal.candidate); } catch { /* conexão encerrada */ }
    } else if (signal.kind === "answer" && signal.sdp?.type === "answer" && session.peer && !session.peer.remoteDescription && !session.processingAnswer) {
      session.processingAnswer = true;
      try {
        if (session.inviteTimer) clearInterval(session.inviteTimer);
        await session.peer.setRemoteDescription(signal.sdp);
        await addPendingIce(session);
        setView((current) => current ? { ...current, stage: "connecting" } : current);
      } catch { stopSession(true, "Não foi possível conectar a ligação."); }
      finally { session.processingAnswer = false; }
    } else if (signal.kind === "reject" || signal.kind === "busy") {
      stopSession(false, signal.kind === "busy" ? "A outra pessoa está em outra ligação." : "Ligação recusada.");
    } else if (signal.kind === "end") {
      stopSession(false, "Ligação encerrada.");
    }
  }

  handlerRef.current = (room, signal) => { void onSignal(room, signal); };

  function rejectCall() {
    const session = sessionRef.current;
    if (!session) return;
    void send(session.roomId, { kind: "reject", id: session.id, to: session.target });
    stopSession(false);
  }

  function toggleMute() {
    const session = sessionRef.current;
    if (!session?.stream) return;
    const track = session.stream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setView((current) => current ? { ...current, muted: !track.enabled } : current);
  }

  const callUi = (
    <>
      <audio ref={attachAudio} autoPlay playsInline className="voice-remote-audio" />
      {view && <div className="voice-backdrop" role="presentation">
        <section className="voice-sheet" role="dialog" aria-modal="true" aria-label="Ligação de voz">
          <span className="voice-room">{view.room}</span>
          <div className="voice-mark"><PhoneIcon /></div>
          <h2>{view.name}</h2>
          <p aria-live="polite">{view.stage === "incoming" ? "Ligação de voz recebida" : view.stage === "calling" ? "Chamando..." : view.stage === "connecting" ? "Conectando..." : elapsed(view.startedAt)}</p>
          {needsPlay && <button type="button" className="voice-sound" onClick={() => { void audioRef.current?.play().then(() => setNeedsPlay(false)); }}>Ativar som</button>}
          <div className="voice-actions">
            {view.stage === "incoming" ? <>
              <button type="button" className="voice-action voice-decline" onClick={rejectCall}><PhoneIcon crossed /><span>Recusar</span></button>
              <button type="button" className="voice-action voice-accept" onClick={() => void acceptCall()}><PhoneIcon /><span>Atender</span></button>
            </> : <>
              <button type="button" className={`voice-action voice-mute ${view.muted ? "is-muted" : ""}`} onClick={toggleMute} disabled={!sessionRef.current?.stream}><MicIcon muted={view.muted} /><span>{view.muted ? "Ativar mic" : "Silenciar"}</span></button>
              <button type="button" className="voice-action voice-decline" onClick={() => stopSession(true)}><PhoneIcon crossed /><span>Encerrar</span></button>
            </>}
          </div>
        </section>
      </div>}
      {notice && <div className="voice-notice" role="status">{notice}</div>}
    </>
  );

  return { startVoiceCall, callUi, inCall: !!view, seconds };
}
