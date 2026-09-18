"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Msg = { id: string; author: string; content: string; created_at: string };

type ParsedMsg = {
  type: "text" | "image";
  text?: string;
  image?: string;
};

function parseContent(content: string): ParsedMsg {
  if (content.startsWith("data:image/")) {
    return { type: "image", image: content, text: "" };
  }
  if (content.startsWith("{") && content.endsWith("}")) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && parsed.type === "image" && parsed.image) {
        return {
          type: "image",
          image: parsed.image as string,
          text: (parsed.text as string) || "",
        };
      }
    } catch {
      // continua para fallback de texto
    }
  }
  return { type: "text", text: content };
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
  const [fotoAnexada, setFotoAnexada] = useState<string | null>(null);
  const [processandoFoto, setProcessandoFoto] = useState(false);
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fim = useRef<HTMLDivElement>(null);
  const sb = useRef<SupabaseClient | null>(null);

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

  // carrega histórico + escuta novas mensagens em tempo real
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

    const canal = client
      .channel(`sala:${sala}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages_chat", filter: `room=eq.${sala}` },
        (payload) =>
          setMsgs((atuais) => {
            const nova = payload.new as Msg;
            // troca a cópia otimista (tmp) pela real do banco
            const semTmp = atuais.filter(
              (m) => !(m.id.startsWith("tmp-") && m.author === nova.author && m.content === nova.content)
            );
            return semTmp.some((m) => m.id === nova.id) ? semTmp : [...semTmp, nova];
          })
      )
      .subscribe();

    return () => {
      client.removeChannel(canal);
    };
  }, [sala]);

  // rola pro fim quando chega mensagem
  useEffect(() => {
    fim.current?.scrollIntoView();
  }, [msgs]);

  // colar imagem da área de transferência (Ctrl+V / Cmd+V) e fechar lightbox com Esc
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!sala || !nome) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            carregarFoto(file);
            break;
          }
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFotoAmpliada(null);
      }
    };

    window.addEventListener("paste", handlePaste);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("paste", handlePaste);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sala, nome]);

  async function carregarFoto(file: File) {
    if (!file.type.startsWith("image/")) {
      alert("Por favor, selecione um arquivo de imagem.");
      return;
    }
    setProcessandoFoto(true);
    try {
      const dataUrl = await otimizarImagem(file);
      setFotoAnexada(dataUrl);
    } catch (err) {
      alert("Não foi possível carregar a imagem: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setProcessandoFoto(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
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

  async function enviar() {
    const textoLimpo = texto.trim();
    if ((!textoLimpo && !fotoAnexada) || !sala || !nome || !sb.current || processandoFoto) return;

    const conteudo = fotoAnexada
      ? JSON.stringify({
          type: "image",
          image: fotoAnexada,
          text: textoLimpo,
        })
      : textoLimpo;

    setTexto("");
    setFotoAnexada(null);

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
        const file = e.dataTransfer.files?.[0];
        if (file) carregarFoto(file);
      }}
    >
      <div className="topo" />
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
              if (parsed.type === "image" && parsed.image) {
                return (
                  <div key={m.id} className={`msg msg-foto ${souEu ? "eu" : "ela"}`}>
                    <img
                      src={parsed.image}
                      alt="Foto enviada"
                      className="msg-foto-img"
                      onLoad={() => fim.current?.scrollIntoView()}
                      onClick={() => setFotoAmpliada(parsed.image!)}
                    />
                    {parsed.text ? <div className="msg-foto-legenda">{parsed.text}</div> : null}
                  </div>
                );
              }
              return (
                <div key={m.id} className={souEu ? "msg eu" : "msg ela"}>
                  {m.content}
                </div>
              );
            })}
            <div ref={fim} />
          </div>

          {/* Miniatura da foto antes de enviar */}
          {fotoAnexada && (
            <div className="preview-foto-wrap">
              <div className="preview-foto">
                <img src={fotoAnexada} alt="Foto pronta para envio" />
                <button
                  type="button"
                  className="preview-remover"
                  onClick={() => setFotoAnexada(null)}
                  title="Remover foto"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          <div className="input-bar">
            {/* Input oculto para selecionar foto */}
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) carregarFoto(file);
              }}
            />

            <button
              type="button"
              className="btn-foto"
              onClick={() => fileInputRef.current?.click()}
              title="Enviar foto (ou cole com Ctrl+V)"
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

            <input
              className="campo"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && enviar()}
              placeholder={fotoAnexada ? "adicionar legenda (opcional)..." : "escreve aqui (ou cole uma foto)"}
            />

            <button className="enviar" onClick={enviar} disabled={(!texto.trim() && !fotoAnexada) || processandoFoto}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </>
      )}

      {/* Visualizador da foto ampliada em tela cheia (Lightbox) */}
      {fotoAmpliada && (
        <div className="lightbox-wrap" onClick={() => setFotoAmpliada(null)}>
          <div className="lightbox-acoes" onClick={(e) => e.stopPropagation()}>
            <a
              href={fotoAmpliada}
              download="foto.webp"
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
              onClick={() => setFotoAmpliada(null)}
              title="Fechar (Esc)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Fechar
            </button>
          </div>
          <img
            src={fotoAmpliada}
            alt="Foto em alta resolução"
            className="lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
