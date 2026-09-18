"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Msg = { id: string; author: string; content: string; created_at: string };

type ReplyInfo = {
  id: string;
  autor: string;
  resumo: string;
  type?: "text" | "image" | "audio";
};

type ParsedMsg = {
  type: "text" | "image" | "audio";
  text?: string;
  image?: string;
  images?: string[];
  audio?: string;
  duration?: number;
  reactions?: Record<string, string[]>;
  replyTo?: ReplyInfo;
};

function parseContent(content: string): ParsedMsg {
  if (content.startsWith("data:image/")) {
    return { type: "image", image: content, images: [content], text: "" };
  }
  if (content.startsWith("data:audio/")) {
    return { type: "audio", audio: content };
  }
  if (content.startsWith("{") && content.endsWith("}")) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object") {
        const imagesList: string[] | undefined = Array.isArray(parsed.images)
          ? parsed.images
          : typeof parsed.image === "string"
          ? [parsed.image]
          : undefined;

        return {
          type: parsed.type || (imagesList ? "image" : "text"),
          text: (parsed.text as string) || "",
          image: (parsed.image as string) || (imagesList && imagesList[0] ? imagesList[0] : undefined),
          images: imagesList,
          audio: parsed.audio as string | undefined,
          duration: parsed.duration as number | undefined,
          reactions: parsed.reactions,
          replyTo: parsed.replyTo as ReplyInfo | undefined,
        };
      }
    } catch {
      // continua para fallback de texto
    }
  }
  return { type: "text", text: content };
}

function extrairResumo(content: string): { resumo: string; type: "text" | "image" | "audio" } {
  const parsed = parseContent(content);
  if (parsed.type === "image") {
    const count = parsed.images && parsed.images.length > 1 ? ` (${parsed.images.length} fotos)` : "";
    return { resumo: parsed.text ? `📷 ${parsed.text}` : `📷 Foto${count}`, type: "image" };
  }
  if (parsed.type === "audio") {
    const dur = parsed.duration ? ` (${formatTempo(parsed.duration)})` : "";
    return { resumo: `🎙️ Áudio${dur}`, type: "audio" };
  }
  return { resumo: parsed.text || "Mensagem", type: "text" };
}

function GaleriaFotos({
  images,
  onAmpliar,
}: {
  images: string[];
  onAmpliar: (index: number) => void;
}) {
  const total = images.length;

  if (total === 1) {
    return (
      <img
        src={images[0]}
        alt="Foto enviada"
        className="msg-foto-img borda-zero"
        onClick={() => onAmpliar(0)}
      />
    );
  }

  const exibidas = images.slice(0, 4);
  const restantes = total - 4;

  let layoutClass = "grid-4";
  if (total === 2) layoutClass = "grid-2";
  if (total === 3) layoutClass = "grid-3";

  return (
    <div className={`galeria-grid ${layoutClass}`}>
      {exibidas.map((src, i) => {
        const isLastAndMore = i === 3 && restantes > 0;
        return (
          <div
            key={i}
            className="galeria-item"
            onClick={(e) => {
              e.stopPropagation();
              onAmpliar(i);
            }}
          >
            <img src={src} alt={`Foto ${i + 1}`} className="galeria-img" />
            {isLastAndMore && (
              <div className="galeria-mais-overlay">
                <span>+{restantes + 1}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MsgQuote({
  replyTo,
  nomeUsuario,
  onNavigate,
}: {
  replyTo: ReplyInfo;
  nomeUsuario: string | null;
  onNavigate: (id: string) => void;
}) {
  return (
    <div
      className="msg-quote"
      onClick={(e) => {
        e.stopPropagation();
        onNavigate(replyTo.id);
      }}
      title="Ir para a mensagem citada"
    >
      <div className="msg-quote-linha" />
      <div className="msg-quote-info">
        <span className="msg-quote-nome">
          {replyTo.autor === nomeUsuario ? "Você" : replyTo.autor}
        </span>
        <span className="msg-quote-trecho">{replyTo.resumo}</span>
      </div>
    </div>
  );
}

function formatarHora(isoString: string) {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function getAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function formatTempo(s: number) {
  const mins = Math.floor(s / 60);
  const segs = Math.floor(s % 60);
  return `${mins}:${segs < 10 ? "0" : ""}${segs}`;
}

function AudioPlayer({
  src,
  duration,
  souEu,
  hora,
}: {
  src: string;
  duration?: number;
  souEu: boolean;
  hora?: string;
}) {
  const [tocando, setTocando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [tempoAtual, setTempoAtual] = useState(0);
  const [duracaoTotal, setDuracaoTotal] = useState(duration || 0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const a = new Audio(src);
    audioRef.current = a;
    a.onloadedmetadata = () => {
      if (a.duration && isFinite(a.duration)) setDuracaoTotal(a.duration);
    };
    a.ontimeupdate = () => {
      setTempoAtual(a.currentTime);
      if (a.duration) setProgresso((a.currentTime / a.duration) * 100);
    };
    a.onended = () => {
      setTocando(false);
      setProgresso(0);
      setTempoAtual(0);
    };
    return () => {
      a.pause();
      a.src = "";
    };
  }, [src]);

  function togglePlay() {
    if (!audioRef.current) return;
    if (tocando) {
      audioRef.current.pause();
      setTocando(false);
    } else {
      audioRef.current
        .play()
        .then(() => setTocando(true))
        .catch(() => {});
    }
  }

  return (
    <div className={`audio-player-enxuto ${souEu ? "audio-eu" : "audio-ela"}`}>
      <button
        type="button"
        className="audio-btn-play-enxuto"
        onClick={togglePlay}
        title={tocando ? "Pausar" : "Tocar"}
      >
        {tocando ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1.5" />
            <rect x="14" y="4" width="4" height="16" rx="1.5" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: "1px" }}>
            <path d="M6 4l14 8-14 8V4z" />
          </svg>
        )}
      </button>
      <div className="audio-col-dados">
        <div
          className="audio-barra-track"
          onClick={(e) => {
            if (!audioRef.current || !duracaoTotal) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const ratio = Math.max(0, Math.min(1, clickX / rect.width));
            audioRef.current.currentTime = ratio * duracaoTotal;
          }}
        >
          <div className="audio-barra-progresso-enxuto" style={{ width: `${progresso}%` }} />
        </div>
        <div className="audio-meta-enxuto">
          <span className="audio-tempo-enxuto">
            {formatTempo(tempoAtual > 0 ? tempoAtual : duracaoTotal)}
          </span>
          {hora && <span className="audio-hora-enxuto">{hora}</span>}
        </div>
      </div>
    </div>
  );
}


// Otimiza com canvas para resolução Full HD+ e formato WebP leve (~120KB-250KB)
async function otimizarImagem(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      return reject(new Error("O arquivo selecionado não é uma imagem válida."));
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_DIM = 1600; // Nitidez cristalina em telas Retina sem travar o realtime
        let { width, height } = img;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return reject(new Error("Não foi possível processar a imagem."));
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = canvas.toDataURL("image/webp", 0.82);
        if (!dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        }
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("Erro ao ler a imagem."));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Erro ao abrir arquivo."));
    reader.readAsDataURL(file);
  });
}

function tocarSomNotificacao() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    // Primeiro tom suave (F5 - 698Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(698.46, ctx.currentTime);
    gain1.gain.setValueAtTime(0.06, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.12);

    // Segundo tom (A5 - 880Hz), sutil e agradável estilo iMessage
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.07);
    gain2.gain.setValueAtTime(0.08, ctx.currentTime + 0.07);
    gain2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.07);
    osc2.stop(ctx.currentTime + 0.28);
  } catch {
    // áudio bloqueado ou não suportado
  }
}

function novaSala() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export default function Home() {
  const [sala, setSala] = useState<string | null>(null);
  const [nome, setNome] = useState<string | null>(null);
  const [nomeDigitado, setNomeDigitado] = useState("");
  const [codigo, setCodigo] = useState("");
  const [salaCriada, setSalaCriada] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [fotosAnexadas, setFotosAnexadas] = useState<string[]>([]);
  const [processandoFoto, setProcessandoFoto] = useState(false);
  const [lightboxState, setLightboxState] = useState<{ images: string[]; index: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [usuariosOnline, setUsuariosOnline] = useState<string[]>([]);
  const [typingTimestamps, setTypingTimestamps] = useState<Record<string, number>>({});
  const [digitando, setDigitando] = useState<string[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);

  const [seletorAbertoId, setSeletorAbertoId] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [gravandoTempo, setGravandoTempo] = useState(0);
  const [respondendoA, setRespondendoA] = useState<ReplyInfo | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputMsgRef = useRef<HTMLInputElement>(null);
  const fim = useRef<HTMLDivElement>(null);
  const sb = useRef<SupabaseClient | null>(null);
  const canalRef = useRef<ReturnType<SupabaseClient["channel"]> | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const gravandoTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  function abrirLightbox(images: string[], index: number = 0) {
    setLightboxState({ images, index });
  }

  function fecharLightbox() {
    setLightboxState(null);
  }

  function fotoAnterior(e?: React.MouseEvent) {
    e?.stopPropagation();
    setLightboxState((cur) => {
      if (!cur || cur.images.length <= 1) return cur;
      return { ...cur, index: (cur.index - 1 + cur.images.length) % cur.images.length };
    });
  }

  function fotoProxima(e?: React.MouseEvent) {
    e?.stopPropagation();
    setLightboxState((cur) => {
      if (!cur || cur.images.length <= 1) return cur;
      return { ...cur, index: (cur.index + 1) % cur.images.length };
    });
  }

  function removerFotoAnexada(index: number) {
    setFotosAnexadas((atuais) => atuais.filter((_, i) => i !== index));
  }

  function iniciarResposta(m: Msg) {
    const { resumo, type } = extrairResumo(m.content);
    setRespondendoA({
      id: m.id,
      autor: m.author,
      resumo,
      type,
    });
    inputMsgRef.current?.focus();
  }

  function navegarAteMensagem(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("msg-destaque-piscar");
      setTimeout(() => {
        el.classList.remove("msg-destaque-piscar");
      }, 1500);
    }
  }

  // Fecha o menu de reações ao clicar fora
  useEffect(() => {
    const fecharSeletor = () => setSeletorAbertoId(null);
    window.addEventListener("click", fecharSeletor);
    return () => window.removeEventListener("click", fecharSeletor);
  }, []);

  // se a URL tem sala (?r=abc123) entra direto e memoriza; senão volta pra sala memorizada
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("r");
    if (r) {
      setSala(r);
      localStorage.setItem("minha-sala", r);
    } else {
      const salva = localStorage.getItem("minha-sala");
      if (salva) {
        window.history.replaceState(null, "", `?r=${salva}`);
        setSala(salva);
      }
    }
    setNome(localStorage.getItem("meu-nome"));
  }, []);

  // atualiza o título da aba com o número de mensagens não lidas
  useEffect(() => {
    if (naoLidas > 0) {
      document.title = `(${naoLidas}) nosso bloco`;
    } else {
      document.title = "nosso bloco";
    }
  }, [naoLidas]);

  // reseta o contador de não lidas ao voltar para a aba
  useEffect(() => {
    const limparNaoLidas = () => setNaoLidas(0);
    window.addEventListener("focus", limparNaoLidas);
    const onVisibilityChange = () => {
      if (!document.hidden) setNaoLidas(0);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", limparNaoLidas);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // calcula quem está digitando nos últimos 3.2s
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const ativos = Object.entries(typingTimestamps)
        .filter(([user, time]) => user !== nome && now - time < 3200)
        .map(([user]) => user);

      setDigitando((prev) => {
        if (prev.length === ativos.length && prev.every((u, i) => u === ativos[i])) {
          return prev;
        }
        return ativos;
      });
    }, 400);

    return () => clearInterval(interval);
  }, [typingTimestamps, nome]);

  // carrega histórico + escuta mensagens, presença e typing em tempo real
  useEffect(() => {
    if (!sala || !URL || !KEY) return;
    const client = createClient(URL, KEY);
    sb.current = client;

    client
      .from("messages_chat")
      .select("id, author, content, created_at")
      .eq("room", sala)
      .order("created_at", { ascending: true })
      .limit(300)
      .then(({ data }) => {
        if (data) setMsgs(data as Msg[]);
      });

    const canal = client.channel(`sala:${sala}`, {
      config: {
        broadcast: { self: false },
        presence: { key: nome || "anônimo" },
      },
    });
    canalRef.current = canal;

    canal
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages_chat", filter: `room=eq.${sala}` },
        (payload) => {
          const nova = payload.new as Msg;
          setMsgs((atuais) => {
            // troca a cópia otimista (tmp) pela real do banco
            const semTmp = atuais.filter(
              (m) => !(m.id.startsWith("tmp-") && m.author === nova.author && m.content === nova.content)
            );
            return semTmp.some((m) => m.id === nova.id) ? semTmp : [...semTmp, nova];
          });

          // Notificação de som e aba se a mensagem veio de outra pessoa
          if (nova.author !== nome) {
            tocarSomNotificacao();
            if (document.hidden) {
              setNaoLidas((n) => n + 1);
            }
            // remove o indicador de digitando de quem acabou de enviar
            setTypingTimestamps((prev) => ({ ...prev, [nova.author]: 0 }));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages_chat", filter: `room=eq.${sala}` },
        (payload) => {
          const atualizada = payload.new as Msg;
          setMsgs((atuais) => atuais.map((m) => (m.id === atualizada.id ? atualizada : m)));
        }
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.user && payload.user !== nome) {
          setTypingTimestamps((prev) => ({
            ...prev,
            [payload.user]: payload.typing ? Date.now() : 0,
          }));
        }
      })
      .on("presence", { event: "sync" }, () => {
        const state = canal.presenceState<{ user: string }>();
        const users = Object.values(state)
          .flat()
          .map((p) => p.user)
          .filter(Boolean);
        const unicos = Array.from(new Set(users));
        setUsuariosOnline(unicos);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED" && nome) {
          await canal.track({ user: nome });
        }
      });

    return () => {
      canalRef.current = null;
      client.removeChannel(canal);
    };
  }, [sala, nome]);

  // rola pro fim quando chega mensagem ou alguém está digitando
  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, digitando]);

  // colar imagem da área de transferência (Ctrl+V / Cmd+V) e fechar lightbox com Esc
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!sala || !nome) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        carregarFotos(files);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxState(null);
        setRespondendoA(null);
      }
      if (e.key === "ArrowLeft") {
        setLightboxState((cur) => {
          if (!cur || cur.images.length <= 1) return cur;
          return { ...cur, index: (cur.index - 1 + cur.images.length) % cur.images.length };
        });
      }
      if (e.key === "ArrowRight") {
        setLightboxState((cur) => {
          if (!cur || cur.images.length <= 1) return cur;
          return { ...cur, index: (cur.index + 1) % cur.images.length };
        });
      }
    };

    window.addEventListener("paste", handlePaste);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("paste", handlePaste);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sala, nome]);

  async function carregarFotos(files: File[] | FileList) {
    const lista = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (lista.length === 0) {
      alert("Por favor, selecione arquivos de imagem válidos.");
      return;
    }
    setProcessandoFoto(true);
    try {
      const urls = await Promise.all(lista.map((f) => otimizarImagem(f)));
      setFotosAnexadas((atuais) => [...atuais, ...urls]);
    } catch (err) {
      alert("Não foi possível carregar as fotos: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setProcessandoFoto(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function iniciarGravacao() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = getAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.start(100);
      setGravando(true);
      setGravandoTempo(0);

      if (gravandoTimerRef.current) clearInterval(gravandoTimerRef.current);
      gravandoTimerRef.current = setInterval(() => {
        setGravandoTempo((t) => t + 1);
      }, 1000);
    } catch {
      alert("Não foi possível acessar o microfone. Verifique as permissões do navegador.");
    }
  }

  function cancelarGravacao() {
    if (gravandoTimerRef.current) clearInterval(gravandoTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setGravando(false);
    setGravandoTempo(0);
    audioChunksRef.current = [];
  }

  async function pararEEnviarGravacao() {
    if (!mediaRecorderRef.current || !sala || !nome || !sb.current) {
      cancelarGravacao();
      return;
    }

    const duracao = gravandoTempo;
    if (gravandoTimerRef.current) clearInterval(gravandoTimerRef.current);

    const recorder = mediaRecorderRef.current;
    recorder.onstop = async () => {
      const mimeType = recorder.mimeType || "audio/webm";
      const blob = new Blob(audioChunksRef.current, { type: mimeType });

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      setGravando(false);
      setGravandoTempo(0);
      audioChunksRef.current = [];

      if (duracao < 1 && blob.size < 1000) {
        return;
      }

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;
        const rep = respondendoA;
        setRespondendoA(null);
        const conteudo = JSON.stringify({
          type: "audio",
          audio: base64Audio,
          duration: duracao,
          replyTo: rep || undefined,
        });

        const idTemp = "tmp-" + crypto.randomUUID();
        setMsgs((atuais) => [
          ...atuais,
          { id: idTemp, author: nome, content: conteudo, created_at: new Date().toISOString() },
        ]);

        const { error } = await sb.current!
          .from("messages_chat")
          .insert({ room: sala, author: nome, content: conteudo });

        if (error) {
          setMsgs((atuais) => atuais.filter((m) => m.id !== idTemp));
          alert("Não foi possível enviar o áudio: " + error.message);
        }
      };
      reader.readAsDataURL(blob);
    };

    recorder.stop();
  }

  async function toggleReacao(msgId: string, emoji: string) {
    if (!nome || !sb.current || !sala) return;

    const alvo = msgs.find((m) => m.id === msgId);
    if (!alvo) return;

    const parsed = parseContent(alvo.content);
    const reacoesAtuais = { ...(parsed.reactions || {}) };
    const lista = [...(reacoesAtuais[emoji] || [])];

    if (lista.includes(nome)) {
      const filtrada = lista.filter((u) => u !== nome);
      if (filtrada.length === 0) {
        delete reacoesAtuais[emoji];
      } else {
        reacoesAtuais[emoji] = filtrada;
      }
    } else {
      reacoesAtuais[emoji] = [...lista, nome];
    }

    let novoConteudo: string;
    if (parsed.type === "image") {
      novoConteudo = JSON.stringify({
        type: "image",
        image: parsed.image,
        text: parsed.text || "",
        reactions: reacoesAtuais,
      });
    } else if (parsed.type === "audio") {
      novoConteudo = JSON.stringify({
        type: "audio",
        audio: parsed.audio,
        duration: parsed.duration,
        reactions: reacoesAtuais,
      });
    } else {
      novoConteudo = JSON.stringify({
        type: "text",
        text: parsed.text || "",
        reactions: reacoesAtuais,
      });
    }

    setMsgs((atuais) =>
      atuais.map((m) => (m.id === msgId ? { ...m, content: novoConteudo } : m))
    );

    await sb.current
      .from("messages_chat")
      .update({ content: novoConteudo })
      .eq("id", msgId);
  }

  function salvarNome() {
    const limpo = nomeDigitado.trim();
    if (!limpo) return;
    localStorage.setItem("meu-nome", limpo);
    setNome(limpo);
  }

  function criarSala() {
    const novo = novaSala();
    setSalaCriada(novo);
    setCopiado(false);
  }

  function entrarNaCriada() {
    if (!salaCriada) return;
    window.history.replaceState(null, "", `?r=${salaCriada}`);
    localStorage.setItem("minha-sala", salaCriada);
    setSala(salaCriada);
  }

  function entrarComCodigo() {
    const limpo = codigo.trim();
    if (!limpo) return;
    window.history.replaceState(null, "", `?r=${limpo}`);
    localStorage.setItem("minha-sala", limpo);
    setSala(limpo);
  }

  function sairDaSala() {
    if (!window.confirm("sair da sala?")) return;
    localStorage.removeItem("minha-sala");
    localStorage.removeItem("meu-nome");
    window.location.replace("/");
  }

  async function copiarLink() {
    if (!salaCriada) return;
    await navigator.clipboard.writeText(`${window.location.origin}/?r=${salaCriada}`);
    setCopiado(true);
  }

  function avisarDigitando(estaDigitando: boolean) {
    if (!canalRef.current || !nome) return;
    canalRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { user: nome, typing: estaDigitando },
    });
  }

  function handleTextoChange(e: React.ChangeEvent<HTMLInputElement>) {
    setTexto(e.target.value);
    if (!nome) return;

    const now = Date.now();
    if (now - lastTypingSentRef.current > 1200) {
      avisarDigitando(true);
      lastTypingSentRef.current = now;
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      avisarDigitando(false);
    }, 2200);
  }

  async function enviar() {
    const textoLimpo = texto.trim();
    if ((!textoLimpo && fotosAnexadas.length === 0) || !sala || !nome || !sb.current || processandoFoto) return;

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    avisarDigitando(false);

    const rep = respondendoA;
    setRespondendoA(null);

    const conteudo = fotosAnexadas.length > 0
      ? JSON.stringify({
          type: "image",
          image: fotosAnexadas[0],
          images: fotosAnexadas,
          text: textoLimpo,
          replyTo: rep || undefined,
        })
      : rep
      ? JSON.stringify({
          type: "text",
          text: textoLimpo,
          replyTo: rep,
        })
      : textoLimpo;

    setTexto("");
    setFotosAnexadas([]);

    // mostra na hora; o echo do realtime é ignorado pelo dedup de id
    const idTemp = "tmp-" + crypto.randomUUID();
    setMsgs((atuais) => [...atuais, { id: idTemp, author: nome, content: conteudo, created_at: new Date().toISOString() }]);
    const { error } = await sb.current.from("messages_chat").insert({ room: sala, author: nome, content: conteudo });
    if (error) {
      setMsgs((atuais) => atuais.filter((m) => m.id !== idTemp));
      alert("não deu pra enviar: " + error.message);
    }
  }

  if (!sala) {
    return (
      <div className="entrada-wrap">
        <div className="entrada">
          {salaCriada === null ? (
            <>
              <h1>nosso bloco</h1>
              <p className="sub">converse com quem você quiser, sem login</p>
              <button className="btn-grande btn-azul" onClick={criarSala}>criar uma sala</button>
              <div className="divisor">ou entre com um código</div>
              <div className="entrar-codigo">
                <input
                  className="campo"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && entrarComCodigo()}
                  placeholder="código da sala"
                />
                <button className="btn-grande btn-cinza" onClick={entrarComCodigo} disabled={!codigo.trim()}>
                  entrar
                </button>
              </div>
            </>
          ) : (
            <>
              <h1>sala pronta!</h1>
              <p className="sub">manda esse link pra quem você quer conversar</p>
              <div className="link-pronto">
                <code>{`${typeof window !== "undefined" ? window.location.origin : ""}/?r=${salaCriada}`}</code>
                <button className="btn-grande btn-cinza" onClick={copiarLink}>
                  {copiado ? "copiado!" : "copiar link"}
                </button>
              </div>
              <button className="btn-grande btn-azul" onClick={entrarNaCriada}>entrar na sala</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="bloco"
      onDragOver={(e) => {
        e.preventDefault();
        if (!arrastando) setArrastando(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setArrastando(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setArrastando(false);
        const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith("image/"));
        if (files.length > 0) carregarFotos(files);
      }}
    >
      <div className="topo" />
      <div className="topo-info">
        <div
          className="online-badge"
          title={usuariosOnline.length > 0 ? `Na sala: ${usuariosOnline.join(", ")}` : "Você está na sala"}
        >
          <span className="online-ponto" />
          <span>
            {usuariosOnline.length <= 1
              ? "só você online"
              : `${usuariosOnline.length} online`}
          </span>
        </div>
      </div>
      <button className="sair" onClick={sairDaSala}>sair</button>

      {/* Overlay ao arrastar uma foto para o chat */}
      {arrastando && (
        <div className="overlay-drag">
          <div className="overlay-drag-caixa">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2F80ED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="4" ry="4" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <p>solte a foto aqui para enviar</p>
          </div>
        </div>
      )}

      {nome === null || !sala ? (
        <div className="pedir-nome">
          <p>como você se chama?</p>
          <div className="input-bar" style={{ paddingTop: 0, paddingBottom: 0 }}>
            <input
              className="campo"
              value={nomeDigitado}
              onChange={(e) => setNomeDigitado(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && salvarNome()}
              placeholder="seu nome"
              autoFocus
            />
            <button className="enviar" onClick={salvarNome} disabled={!nomeDigitado.trim()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="msgs">
            {msgs.map((m) => {
              const parsed = parseContent(m.content);
              const souEu = m.author === nome;
              const temReacoes = parsed.reactions && Object.keys(parsed.reactions).length > 0;
              const emojis = ["❤️", "😂", "👍", "🔥", "😮", "🎉"];

              return (
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  className={`msg-wrap ${souEu ? "wrap-eu" : "wrap-ela"}`}
                  onDoubleClick={() => iniciarResposta(m)}
                  title="Duplo clique para responder"
                >
                  <div className="msg-linha">
                    {/* Ações da mensagem (Responder + Reagir) */}
                    <div className="msg-acoes-wrap">
                      <button
                        type="button"
                        className="btn-msg-acao"
                        onClick={() => iniciarResposta(m)}
                        title="Responder"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 17 4 12 9 7" />
                          <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        className="btn-msg-acao"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSeletorAbertoId(seletorAbertoId === m.id ? null : m.id);
                        }}
                        title="Reagir com emoji"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                          <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3" />
                          <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3" />
                        </svg>
                      </button>

                      {/* Menu popup de emojis */}
                      {seletorAbertoId === m.id && (
                        <div className="seletor-reacoes" onClick={(e) => e.stopPropagation()}>
                          {emojis.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="seletor-emoji-btn"
                              onClick={() => {
                                toggleReacao(m.id, emoji);
                                setSeletorAbertoId(null);
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Conteúdo da bolha */}
                    {parsed.type === "image" && (parsed.images || parsed.image) ? (
                      (() => {
                        const imagesList = parsed.images && parsed.images.length > 0 ? parsed.images : [parsed.image!];
                        const isMulti = imagesList.length > 1;

                        return parsed.replyTo || parsed.text ? (
                          <div className={`msg msg-foto com-legenda ${souEu ? "eu" : "ela"} ${isMulti ? "msg-album" : ""}`}>
                            {parsed.replyTo && (
                              <div style={{ padding: "6px 8px 2px" }}>
                                <MsgQuote replyTo={parsed.replyTo} nomeUsuario={nome} onNavigate={navegarAteMensagem} />
                              </div>
                            )}
                            <div className="galeria-wrapper">
                              <GaleriaFotos
                                images={imagesList}
                                onAmpliar={(idx) => abrirLightbox(imagesList, idx)}
                              />
                            </div>
                            {parsed.text ? <div className="msg-foto-legenda">{parsed.text}</div> : null}
                            <span className="msg-hora foto-hora">{formatarHora(m.created_at)}</span>
                          </div>
                        ) : (
                          <div className={`msg-foto-borda-livre ${souEu ? "eu" : "ela"} ${isMulti ? "album-livre" : ""}`}>
                            <div className="msg-foto-container">
                              <GaleriaFotos
                                images={imagesList}
                                onAmpliar={(idx) => abrirLightbox(imagesList, idx)}
                              />
                              <span className="foto-hora-badge">{formatarHora(m.created_at)}</span>
                            </div>
                          </div>
                        );
                      })()
                    ) : parsed.type === "audio" && parsed.audio ? (
                      parsed.replyTo ? (
                        <div className={`msg ${souEu ? "eu" : "ela"}`} style={{ padding: "6px 8px 6px 6px", borderRadius: 20 }}>
                          <div className="msg-conteudo" style={{ gap: 5 }}>
                            <MsgQuote replyTo={parsed.replyTo} nomeUsuario={nome} onNavigate={navegarAteMensagem} />
                            <AudioPlayer
                              src={parsed.audio}
                              duration={parsed.duration}
                              souEu={souEu}
                              hora={formatarHora(m.created_at)}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className={`msg msg-audio ${souEu ? "eu" : "ela"}`}>
                          <AudioPlayer
                            src={parsed.audio}
                            duration={parsed.duration}
                            souEu={souEu}
                            hora={formatarHora(m.created_at)}
                          />
                        </div>
                      )
                    ) : (
                      <div className={`msg ${souEu ? "eu" : "ela"}`}>
                        <div className="msg-conteudo">
                          {parsed.replyTo && (
                            <MsgQuote replyTo={parsed.replyTo} nomeUsuario={nome} onNavigate={navegarAteMensagem} />
                          )}
                          <div className="msg-texto-corpo">{parsed.text}</div>
                          <span className="msg-hora">{formatarHora(m.created_at)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Badges de reações abaixo da mensagem */}
                  {temReacoes && (
                    <div className={`reacoes-barra ${souEu ? "reacoes-dir" : "reacoes-esq"}`}>
                      {Object.entries(parsed.reactions!).map(([emoji, users]) => {
                        if (!users || users.length === 0) return null;
                        const reagi = nome ? users.includes(nome) : false;
                        return (
                          <button
                            key={emoji}
                            type="button"
                            className={`reacao-pill ${reagi ? "ativa" : ""}`}
                            onClick={() => toggleReacao(m.id, emoji)}
                            title={`Reagido por: ${users.join(", ")}`}
                          >
                            <span>{emoji}</span>
                            <span className="reacao-count">{users.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Indicador de alguém digitando */}
            {digitando.length > 0 && (
              <div className="msg-digitando-wrap">
                <div className="msg ela msg-digitando">
                  <span className="ponto-digitando" />
                  <span className="ponto-digitando" />
                  <span className="ponto-digitando" />
                </div>
                <span className="texto-digitando">
                  {digitando.length === 1
                    ? `${digitando[0]} está digitando...`
                    : `${digitando.join(", ")} estão digitando...`}
                </span>
              </div>
            )}
            <div ref={fim} />
          </div>

          {/* Barra ativa de citação (Respondendo a ...) */}
          {respondendoA && (
            <div className="barra-reply-wrap">
              <div className="barra-reply">
                <div className="barra-reply-linha" />
                <div className="barra-reply-corpo">
                  <div className="barra-reply-autor">
                    Respondendo a {respondendoA.autor === nome ? "você" : respondendoA.autor}
                  </div>
                  <div className="barra-reply-texto">{respondendoA.resumo}</div>
                </div>
                <button
                  type="button"
                  className="barra-reply-fechar"
                  onClick={() => setRespondendoA(null)}
                  title="Cancelar resposta"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Miniaturas das fotos antes de enviar */}
          {fotosAnexadas.length > 0 && (
            <div className="preview-fotos-barra">
              <div className="preview-fotos-lista">
                {fotosAnexadas.map((foto, idx) => (
                  <div key={idx} className="preview-foto-card">
                    <img src={foto} alt={`Foto ${idx + 1}`} />
                    <button
                      type="button"
                      className="preview-foto-remover"
                      onClick={() => removerFotoAnexada(idx)}
                      title="Remover foto"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="preview-foto-add-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title="Adicionar mais fotos"
                  disabled={processandoFoto}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {gravando ? (
            <div className="input-bar input-bar-gravando">
              <div className="gravando-status">
                <span className="gravando-ponto" />
                <span className="gravando-tempo">{formatTempo(gravandoTempo)}</span>
                <span className="gravando-texto">Gravando áudio...</span>
              </div>
              <button
                type="button"
                className="btn-cancelar-gravacao"
                onClick={cancelarGravacao}
                title="Cancelar gravação"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <button
                type="button"
                className="enviar"
                onClick={pararEEnviarGravacao}
                title="Enviar áudio"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="input-bar">
              {/* Input oculto para selecionar múltiplas fotos */}
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    carregarFotos(e.target.files);
                  }
                }}
              />

              <button
                type="button"
                className="btn-foto"
                onClick={() => fileInputRef.current?.click()}
                title="Enviar fotos (ou selecione/cole várias com Ctrl+V)"
                disabled={processandoFoto}
              >
                {processandoFoto ? (
                  <span className="spinner" />
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#656D76" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="4" ry="4" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                )}
              </button>

              {/* Botão de gravação de áudio */}
              <button
                type="button"
                className="btn-foto btn-mic"
                onClick={iniciarGravacao}
                title="Gravar áudio"
                disabled={processandoFoto}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#656D76" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>

              <input
                ref={inputMsgRef}
                className="campo"
                value={texto}
                onChange={handleTextoChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) enviar();
                  if (e.key === "Escape" && respondendoA) setRespondendoA(null);
                }}
                placeholder={
                  respondendoA
                    ? `respondendo a ${respondendoA.autor === nome ? "você" : respondendoA.autor}...`
                    : fotosAnexadas.length > 0
                    ? `legenda para ${fotosAnexadas.length === 1 ? "a foto" : `as ${fotosAnexadas.length} fotos`} (opcional)...`
                    : "escreve aqui (ou grave um áudio)"
                }
              />

              <button className="enviar" onClick={enviar} disabled={(!texto.trim() && fotosAnexadas.length === 0) || processandoFoto}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}

      {/* Visualizador da foto ampliada em tela cheia (Lightbox com galeria) */}
      {lightboxState && (
        <div className="lightbox-wrap" onClick={fecharLightbox}>
          <div className="lightbox-topo" onClick={(e) => e.stopPropagation()}>
            {lightboxState.images.length > 1 ? (
              <div className="lightbox-contador">
                {lightboxState.index + 1} / {lightboxState.images.length}
              </div>
            ) : <div />}
            <div className="lightbox-acoes">
              <a
                href={lightboxState.images[lightboxState.index]}
                download={`foto-${lightboxState.index + 1}.webp`}
                className="lightbox-btn"
                title="Baixar imagem"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Baixar
              </a>
              <button
                type="button"
                className="lightbox-btn"
                onClick={fecharLightbox}
                title="Fechar (Esc)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Fechar
              </button>
            </div>
          </div>

          {lightboxState.images.length > 1 && (
            <button
              type="button"
              className="lightbox-nav anterior"
              onClick={fotoAnterior}
              title="Foto anterior (←)"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}

          <img
            src={lightboxState.images[lightboxState.index]}
            alt={`Foto ${lightboxState.index + 1} em alta resolução`}
            className="lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />

          {lightboxState.images.length > 1 && (
            <button
              type="button"
              className="lightbox-nav proximo"
              onClick={fotoProxima}
              title="Próxima foto (→)"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
