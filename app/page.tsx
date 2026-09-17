"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Msg = { id: string; author: string; content: string; created_at: string };

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
  const fim = useRef<HTMLDivElement>(null);
  const sb = useRef<SupabaseClient | null>(null);

  // se a URL já tem sala (?r=abc123), entra direto
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("r");
    if (r) setSala(r);
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
            return atuais.some((m) => m.id === nova.id) ? atuais : [...atuais, nova];
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
    setSala(salaCriada);
  }

  function entrarComCodigo() {
    const limpo = codigo.trim();
    if (!limpo) return;
    window.history.replaceState(null, "", `?r=${limpo}`);
    setSala(limpo);
  }

  async function copiarLink() {
    if (!salaCriada) return;
    await navigator.clipboard.writeText(`${window.location.origin}/?r=${salaCriada}`);
    setCopiado(true);
  }

  async function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || !sala || !nome || !sb.current) return;
    setTexto("");
    // mostra na hora; o echo do realtime é ignorado pelo dedup de id
    const idTemp = "tmp-" + crypto.randomUUID();
    setMsgs((atuais) => [...atuais, { id: idTemp, author: nome, content: conteudo, created_at: new Date().toISOString() }]);
    const { error } = await sb.current.from("messages_chat").insert({ room: sala, author: nome, content: conteudo });
    if (error) {
      setMsgs((atuais) => atuais.filter((m) => m.id !== idTemp));
      alert("não deu pra enviar: " + error.message);
    }
  }

  function aplicarLargura(px: number) {
    const bloco = document.getElementById("bloco");
    if (!bloco) return;
    const w = Math.min(window.innerWidth, Math.max(Math.max(280, window.innerWidth * 0.25), px));
    bloco.style.setProperty("--w", w + "px");
    bloco.classList.toggle("cheio", w >= window.innerWidth - 2);
  }

  function comecarArrasto(e: React.PointerEvent, lado: "esq" | "dir") {
    e.preventDefault();
    const alvo = e.currentTarget as HTMLElement;
    const bloco = document.getElementById("bloco")!;
    const comecoW = bloco.getBoundingClientRect().width;
    const startX = e.clientX;
    alvo.classList.add("on");
    const mover = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      aplicarLargura(lado === "dir" ? comecoW + dx * 2 : comecoW - dx * 2);
    };
    const soltar = () => {
      alvo.classList.remove("on");
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
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
    <div className="bloco" id="bloco" ref={(el) => { if (el) aplicarLargura(860); }}>
      <div className="handle esq" onPointerDown={(e) => comecarArrasto(e, "esq")} title="arraste pra redimensionar" />
      <div className="handle dir" onPointerDown={(e) => comecarArrasto(e, "dir")} title="arraste pra redimensionar" />
      <div className="topo" />

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
            {msgs.map((m) => (
              <div key={m.id} className={m.author === nome ? "eu" : "ela"}>
                {m.content}
              </div>
            ))}
            <div ref={fim} />
          </div>

          <div className="input-bar">
            <input
              className="campo"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && enviar()}
              placeholder="escreve aqui"
            />
            <button className="enviar" onClick={enviar} disabled={!texto.trim()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
