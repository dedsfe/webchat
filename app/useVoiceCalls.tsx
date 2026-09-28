"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient, User } from "@supabase/supabase-js";

type Signal = {
  kind: "invite" | "answer" | "candidate" | "end" | "reject" | "busy" | "screen" | "restart" | "restart-answer";
  id: string;
  from: string;
  to: string;
  device: string;
  name?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  sharing?: boolean;
};

type CallView = {
  stage: "incoming" | "calling" | "connecting" | "active";
  name: string;
  room: string;
  muted: boolean;
  sharingScreen?: boolean;
  remoteSharingScreen?: boolean;
  startedAt?: number;
};

type Session = {
  id: string;
  roomId: string;
  target: string;
  offer?: RTCSessionDescriptionInit;
  peer?: RTCPeerConnection;
  stream?: MediaStream;
  screenStream?: MediaStream;
  screenSender?: RTCRtpSender;
  pendingIce: RTCIceCandidateInit[];
  outgoingIce: RTCIceCandidateInit[];
  canSendIce: boolean;
  timer?: ReturnType<typeof setTimeout>;
  inviteTimer?: ReturnType<typeof setInterval>;
  answerTimer?: ReturnType<typeof setInterval>;
  processingAnswer?: boolean;
  offerer?: boolean;
  restarting?: boolean;
  recoverTimer?: ReturnType<typeof setTimeout>;
  pushStart?: Promise<void>;
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

function ScreenIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8m-4-3v3" /></svg>;
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
  const localScreenRef = useRef<HTMLVideoElement | null>(null);
  const remoteScreenRef = useRef<HTMLVideoElement | null>(null);
  const remoteScreenStreamRef = useRef<MediaStream | null>(null);
  const sharingPendingRef = useRef(false);
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

  const attachLocalScreen = useCallback((node: HTMLVideoElement | null) => {
    localScreenRef.current = node;
    if (node) {
      node.srcObject = sessionRef.current?.screenStream || null;
      if (node.srcObject) void node.play().catch(() => {});
    }
  }, []);

  const attachRemoteScreen = useCallback((node: HTMLVideoElement | null) => {
    remoteScreenRef.current = node;
    if (node) {
      node.srcObject = remoteScreenStreamRef.current;
      if (node.srcObject) void node.play().catch(() => {});
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
        if (document.hidden) document.title = "Ligação recebida · nosso bloco";
        if ("vibrate" in navigator) navigator.vibrate([260, 140, 260]);
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
      if (tellOther) void endCallAlert(session);
      if (session.timer) clearTimeout(session.timer);
      if (session.inviteTimer) clearInterval(session.inviteTimer);
      if (session.answerTimer) clearInterval(session.answerTimer);
      if (session.recoverTimer) clearTimeout(session.recoverTimer);
      session.peer?.close();
      session.stream?.getTracks().forEach((track) => track.stop());
      session.screenStream?.getTracks().forEach((track) => track.stop());
    }
    if (audioRef.current) audioRef.current.srcObject = null;
    if (localScreenRef.current) localScreenRef.current.srcObject = null;
    if (remoteScreenRef.current) remoteScreenRef.current.srcObject = null;
    remoteScreenStreamRef.current = null;
    sharingPendingRef.current = false;
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

  async function callAlert(session: Session, event: "start" | "end") {
    if (!client) return;
    try {
      const { data } = await client.auth.getSession();
      if (!data.session) return;
      await fetch("/api/call-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ event, callId: session.id, roomId: session.roomId }),
      });
    } catch { /* a chamada por WebRTC continua mesmo se o push falhar */ }
  }

  async function endCallAlert(session: Session) {
    await session.pushStart;
    await callAlert(session, "end");
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

  function makePeer(session: Session, offerer = false): RTCPeerConnection {
    const peer = new RTCPeerConnection({ iceServers });
    session.peer = peer;
    session.offerer = offerer;
    // Reserva vídeo na oferta para permitir compartilhar a tela sem renegociar a chamada.
    if (offerer) session.screenSender = peer.addTransceiver("video", { direction: "sendrecv" }).sender;
    peer.onicecandidate = ({ candidate }) => {
      if (!candidate || sessionRef.current !== session) return;
      const ice = candidate.toJSON();
      session.outgoingIce.push(ice);
      if (session.canSendIce) void send(session.roomId, { kind: "candidate", id: session.id, to: session.target, candidate: ice });
    };
    peer.ontrack = ({ streams, track }) => {
      if (track.kind === "video") {
        remoteScreenStreamRef.current = new MediaStream([track]);
        const video = remoteScreenRef.current;
        if (video) {
          video.srcObject = remoteScreenStreamRef.current;
          void video.play().catch(() => {});
        }
        return;
      }
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
        if (session.recoverTimer) clearTimeout(session.recoverTimer);
        session.recoverTimer = undefined;
        session.restarting = false;
        setView((current) => current ? { ...current, stage: "active", startedAt: current.startedAt || Date.now() } : current);
      } else if ((peer.connectionState === "disconnected" || peer.connectionState === "failed") && peer.remoteDescription) {
        // Rede engasgou (comum ao ligar a tela): tenta reconectar antes de derrubar a ligação.
        if (!session.recoverTimer) {
          session.recoverTimer = setTimeout(() => {
            if (sessionRef.current === session && peer.connectionState !== "connected") stopSession(true, "A ligação caiu. Tente novamente.");
          }, 20000);
        }
        if (peer.connectionState === "failed" && session.offerer) void restartIce(session);
      }
    };
    return peer;
  }

  async function restartIce(session: Session) {
    const peer = session.peer;
    if (!peer || session.restarting || sessionRef.current !== session) return;
    session.restarting = true;
    try {
      const offer = await peer.createOffer({ iceRestart: true });
      await peer.setLocalDescription(offer);
      await send(session.roomId, { kind: "restart", id: session.id, to: session.target, sdp: peer.localDescription?.toJSON() });
    } catch { session.restarting = false; }
  }

  // Limita a tela para não lotar a rede, priorizando 30 fps em vez de resolução.
  async function tuneScreenSender(sender: RTCRtpSender) {
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = 2_500_000;
      params.encodings[0].maxFramerate = 30;
      (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = "maintain-framerate";
      await sender.setParameters(params);
    } catch { /* navegador sem suporte a esses parâmetros */ }
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
        const peer = makePeer(session, true);
        session.stream.getTracks().forEach((track) => peer.addTrack(track, session.stream!));
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        const sent = await send(roomId, { kind: "invite", id: session.id, to: session.target, name: (user.user_metadata?.display_name as string | undefined) || "Alguém", sdp: peer.localDescription?.toJSON() });
        if (!sent) throw new Error("signal");
        session.pushStart = callAlert(session, "start");
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
      const screenTransceiver = peer.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === "video");
      if (screenTransceiver) {
        screenTransceiver.direction = "sendrecv";
        session.screenSender = screenTransceiver.sender;
      }
      await addPendingIce(session);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      const sent = await send(session.roomId, { kind: "answer", id: session.id, to: session.target, sdp: peer.localDescription?.toJSON() });
      if (!sent) throw new Error("signal");
      void endCallAlert(session);
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
    } else if (signal.kind === "restart" && signal.sdp?.type === "offer" && session.peer) {
      try {
        await session.peer.setRemoteDescription(signal.sdp);
        const answer = await session.peer.createAnswer();
        await session.peer.setLocalDescription(answer);
        await send(room, { kind: "restart-answer", id: session.id, to: session.target, sdp: session.peer.localDescription?.toJSON() });
      } catch { /* a espera de reconexão encerra se não voltar */ }
    } else if (signal.kind === "restart-answer" && signal.sdp?.type === "answer" && session.peer?.signalingState === "have-local-offer") {
      try { await session.peer.setRemoteDescription(signal.sdp); } catch { /* idem */ }
      finally { session.restarting = false; }
    } else if (signal.kind === "screen") {
      setView((current) => current ? { ...current, remoteSharingScreen: !!signal.sharing } : current);
    }
  }

  handlerRef.current = (room, signal) => { void onSignal(room, signal); };

  function rejectCall() {
    const session = sessionRef.current;
    if (!session) return;
    void send(session.roomId, { kind: "reject", id: session.id, to: session.target });
    void endCallAlert(session);
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

  async function stopScreenShare(session: Session) {
    if (sessionRef.current !== session || !session.screenStream) return;
    const stream = session.screenStream;
    session.screenStream = undefined;
    try { await session.screenSender?.replaceTrack(null); } catch { /* chamada pode ter encerrado */ }
    stream.getTracks().forEach((track) => track.stop());
    if (localScreenRef.current) localScreenRef.current.srcObject = null;
    if (sessionRef.current !== session) return;
    setView((current) => current ? { ...current, sharingScreen: false } : current);
    void send(session.roomId, { kind: "screen", id: session.id, to: session.target, sharing: false });
  }

  async function toggleScreenShare() {
    const session = sessionRef.current;
    if (!session?.peer || sharingPendingRef.current) return;
    if (session.screenStream) { await stopScreenShare(session); return; }
    if (!session.screenSender || !navigator.mediaDevices?.getDisplayMedia) {
      showNotice("Este navegador não permite compartilhar a tela.");
      return;
    }
    sharingPendingRef.current = true;
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 } }, audio: false });
      const track = stream.getVideoTracks()[0];
      if (track) track.contentHint = "motion";
      if (!track || sessionRef.current !== session || session.peer.connectionState !== "connected") {
        stream.getTracks().forEach((item) => item.stop());
        return;
      }
      await session.screenSender.replaceTrack(track);
      await tuneScreenSender(session.screenSender);
      if (sessionRef.current !== session) { stream.getTracks().forEach((item) => item.stop()); return; }
      session.screenStream = stream;
      track.onended = () => { void stopScreenShare(session); };
      setView((current) => current ? { ...current, sharingScreen: true } : current);
      void send(session.roomId, { kind: "screen", id: session.id, to: session.target, sharing: true });
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (!(error instanceof DOMException && error.name === "NotAllowedError")) showNotice("Não foi possível compartilhar a tela.");
    } finally { sharingPendingRef.current = false; }
  }

  const callUi = (
    <>
      <audio ref={attachAudio} autoPlay playsInline className="voice-remote-audio" />
      {view && <div className="voice-backdrop" role="presentation">
        <section className={`voice-sheet ${view.sharingScreen || view.remoteSharingScreen ? "voice-sheet-screen" : ""}`} role="dialog" aria-modal="true" aria-label="Ligação">
          <span className="voice-room">{view.room}</span>
          <div className="voice-mark"><PhoneIcon /></div>
          <h2>{view.name}</h2>
          <p aria-live="polite">{view.stage === "incoming" ? "Ligação de voz recebida" : view.stage === "calling" ? "Chamando..." : view.stage === "connecting" ? "Conectando..." : elapsed(view.startedAt)}</p>
          {(view.remoteSharingScreen || view.sharingScreen) && <div className="voice-screens">
            {view.remoteSharingScreen && <figure className="voice-screen"><video ref={attachRemoteScreen} autoPlay playsInline muted /><figcaption>Tela de {view.name}</figcaption></figure>}
            {view.sharingScreen && <figure className="voice-screen"><video ref={attachLocalScreen} autoPlay playsInline muted /><figcaption>Sua tela</figcaption></figure>}
          </div>}
          {needsPlay && <button type="button" className="voice-sound" onClick={() => { void audioRef.current?.play().then(() => setNeedsPlay(false)); }}>Ativar som</button>}
          <div className="voice-actions">
            {view.stage === "incoming" ? <>
              <button type="button" className="voice-action voice-decline" onClick={rejectCall}><PhoneIcon crossed /><span>Recusar</span></button>
              <button type="button" className="voice-action voice-accept" onClick={() => void acceptCall()}><PhoneIcon /><span>Atender</span></button>
            </> : <>
              <button type="button" className={`voice-action voice-mute ${view.muted ? "is-muted" : ""}`} onClick={toggleMute} disabled={!sessionRef.current?.stream}><MicIcon muted={view.muted} /><span>{view.muted ? "Ativar mic" : "Silenciar"}</span></button>
              <button type="button" className={`voice-action voice-share ${view.sharingScreen ? "is-sharing" : ""}`} onClick={() => void toggleScreenShare()} disabled={view.stage !== "active"}><ScreenIcon /><span>{view.sharingScreen ? "Parar tela" : "Compartilhar tela"}</span></button>
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
