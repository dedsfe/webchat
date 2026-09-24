"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export type ChatRoom = { id: string; title: string; invite_code: string; created_at: string };
const publicSignup = process.env.NEXT_PUBLIC_ALLOW_SIGNUP === "true";

type Props = {
  client: SupabaseClient;
  user: User | null;
  inviteCode: string | null;
  legacyCode: string | null;
  recoveryMode: boolean;
  onRecoveryDone: () => void;
  onEnter: (room: ChatRoom, displayName: string) => void;
  onSignOut: () => void;
};

function messageFor(error: { message: string } | null): string {
  if (!error) return "Não foi possível concluir. Tente novamente.";
  if (/Invalid login credentials/i.test(error.message)) return "E-mail ou senha incorretos.";
  if (/Email not confirmed/i.test(error.message)) return "Confirme seu e-mail antes de entrar.";
  if (/already registered/i.test(error.message)) return "Este e-mail já tem uma conta. Entre com sua senha.";
  if (/schema cache|Could not find the function|relation .* does not exist/i.test(error.message)) {
    return "As salas permanentes ainda estão sendo configuradas. Tente novamente mais tarde.";
  }
  return error.message;
}

function extractInvite(value: string): string | null {
  const trimmed = value.trim();
  let code = trimmed;
  if (trimmed.includes("?")) {
    try { code = new URL(trimmed, window.location.origin).searchParams.get("invite") || ""; }
    catch { return null; }
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(code) ? code : null;
}

export default function AccessGate({ client, user, inviteCode, legacyCode, recoveryMode, onRecoveryDone, onEnter, onSignOut }: Props) {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [roomTitle, setRoomTitle] = useState("Nossa sala");
  const [invite, setInvite] = useState(inviteCode || "");
  const [legacy, setLegacy] = useState(legacyCode || "");
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const displayName = (user?.user_metadata?.display_name as string | undefined)?.trim() || name.trim();

  const loadRooms = useCallback(async () => {
    if (!user) return;
    setLoadingRooms(true);
    const [roomResult, memberResult] = await Promise.all([
      client.from("chat_rooms").select("id,title,invite_code,created_at").order("created_at", { ascending: false }),
      client.from("room_members").select("room_id,display_name").eq("user_id", user.id),
    ]);
    if (roomResult.error) setError(messageFor(roomResult.error));
    else setRooms((roomResult.data || []) as ChatRoom[]);
    if (memberResult.data) {
      setNames(Object.fromEntries(memberResult.data.map((member) => [member.room_id, member.display_name])));
    }
    setLoadingRooms(false);
  }, [client, user]);

  useEffect(() => { void loadRooms(); }, [loadRooms]);
  useEffect(() => { if (inviteCode) setInvite(inviteCode); }, [inviteCode]);
  useEffect(() => { if (legacyCode) setLegacy(legacyCode); }, [legacyCode]);

  async function saveNewPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    const { error: passwordError } = await client.auth.updateUser({ password: newPassword });
    if (passwordError) setError(messageFor(passwordError));
    else { setNotice("Senha atualizada. Sua conta está pronta."); onRecoveryDone(); }
    setBusy(false);
  }

  async function changeAccountPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    const { error: passwordError } = await client.auth.updateUser({
      password: accountPassword,
      current_password: currentPassword,
    });
    if (passwordError) setError(messageFor(passwordError));
    else {
      setCurrentPassword("");
      setAccountPassword("");
      setNotice("Senha atualizada.");
    }
    setBusy(false);
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    if (mode === "reset") {
      const { error: resetError } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (resetError) setError(messageFor(resetError));
      else setNotice("Enviamos um link para redefinir sua senha.");
    } else if (mode === "signup") {
      const cleanName = name.trim();
      if (!cleanName || cleanName.length > 40) {
        setError("Escolha um nome com até 40 caracteres.");
      } else {
        const { data, error: signUpError } = await client.auth.signUp({
          email: email.trim(), password,
          options: { data: { display_name: cleanName } },
        });
        if (signUpError) setError(messageFor(signUpError));
        else if (!data.session) setNotice("Conta criada. Confirme seu e-mail para entrar.");
      }
    } else {
      const { error: loginError } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (loginError) setError(messageFor(loginError));
    }
    setBusy(false);
  }

  async function enterRoom(id: string) {
    const room = rooms.find((item) => item.id === id);
    if (!room) return;
    onEnter(room, names[id] || displayName);
  }

  async function runRoomAction(action: "create" | "join" | "claim") {
    if (!user) return;
    const cleanName = displayName.trim();
    if (!cleanName || cleanName.length > 40) {
      setError("Informe seu nome (até 40 caracteres) para usar as salas.");
      return;
    }
    const parsedInvite = action === "join" ? extractInvite(invite) : null;
    if (action === "join" && !parsedInvite) { setError("Cole um convite válido."); return; }
    if (action === "claim" && (legacy.trim().length < 1 || legacy.trim().length > 128)) { setError("Informe o código da conversa antiga."); return; }
    setBusy(true); setError(""); setNotice("");
    if (!user.user_metadata?.display_name) {
      const { error: profileError } = await client.auth.updateUser({ data: { display_name: cleanName } });
      if (profileError) { setError(messageFor(profileError)); setBusy(false); return; }
    }
    const args = action === "create"
      ? { p_title: roomTitle.trim(), p_display_name: cleanName }
      : action === "join"
      ? { p_invite_code: parsedInvite, p_display_name: cleanName }
      : { p_room_id: legacy.trim(), p_display_name: cleanName };
    const rpc = action === "create" ? "create_chat_room" : action === "join" ? "join_chat_room" : "claim_legacy_chat_room";
    const { data: id, error: rpcError } = await client.rpc(rpc, args);
    if (rpcError || typeof id !== "string") {
      setError(messageFor(rpcError)); setBusy(false); return;
    }
    const { data: room, error: roomError } = await client.from("chat_rooms")
      .select("id,title,invite_code,created_at").eq("id", id).single();
    if (roomError || !room) {
      setError(messageFor(roomError)); setBusy(false); return;
    }
    if (action === "claim") localStorage.removeItem("minha-sala");
    onEnter(room as ChatRoom, cleanName);
    setBusy(false);
  }

  return (
    <main className="access-page">
      <div className="access-shell">
        <div className="access-heading">
          <span className="access-mark" aria-hidden="true">✳</span>
          <h1>nosso bloco</h1>
          <p>Um lugar só de vocês. As conversas e os treinos ficam guardados.</p>
        </div>

        {recoveryMode && user ? (
          <section className="access-panel" aria-label="Nova senha">
            <h2>Escolha uma nova senha</h2>
            <form className="access-form" onSubmit={saveNewPassword}>
              <label>Nova senha<input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} required /></label>
              {error && <p className="access-feedback error" role="alert">{error}</p>}
              <button className="access-primary" type="submit" disabled={busy}>{busy ? "Aguarde..." : "Salvar senha"}</button>
            </form>
          </section>
        ) : !user ? (
          <section className="access-panel" aria-label="Sua conta">
            {publicSignup ? <div className="access-tabs">
              <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); setNotice(""); }}>Entrar</button>
              <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); setNotice(""); }}>Criar conta</button>
            </div> : <h2>Entre na sua conta</h2>}
            <form className="access-form" onSubmit={submitAuth}>
              {mode === "signup" && <label>Seu nome<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /></label>}
              <label>E-mail<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
              {mode !== "reset" && <label>Senha<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /></label>}
              {error && <p className="access-feedback error" role="alert">{error}</p>}
              {notice && <p className="access-feedback" role="status">{notice}</p>}
              <button className="access-primary" disabled={busy} type="submit">{busy ? "Aguarde..." : mode === "signup" ? "Criar minha conta" : mode === "reset" ? "Enviar link" : "Entrar"}</button>
              <button type="button" className="access-text-button" onClick={() => { setMode(mode === "reset" ? "login" : "reset"); setError(""); setNotice(""); }}>
                {mode === "reset" ? "Voltar para entrar" : "Esqueci minha senha"}
              </button>
            </form>
          </section>
        ) : (
          <section className="access-panel" aria-label="Suas salas">
            <div className="access-account"><span>{user.email}</span><button type="button" onClick={onSignOut}>Sair da conta</button></div>
            {!displayName && <label className="access-name">Seu nome<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Como quer aparecer no chat?" /></label>}
            <h2>Suas salas</h2>
            {loadingRooms ? <p className="access-muted">Carregando salas...</p> : rooms.length ? (
              <div className="access-room-list">{rooms.map((room) => <button type="button" key={room.id} onClick={() => enterRoom(room.id)}><span>{room.title}</span><span aria-hidden="true">↗</span></button>)}</div>
            ) : <p className="access-muted">Ainda não há salas nesta conta.</p>}
            <div className="access-actions">
              <form onSubmit={(event) => { event.preventDefault(); void runRoomAction("create"); }}>
                <label>Nova sala<input value={roomTitle} maxLength={60} onChange={(e) => setRoomTitle(e.target.value)} required /></label>
                <button className="access-primary" type="submit" disabled={busy}>Criar sala</button>
              </form>
              <form onSubmit={(event) => { event.preventDefault(); void runRoomAction("join"); }}>
                <label>Convite da outra pessoa<input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Cole o link ou código do convite" required /></label>
                <button className="access-secondary" type="submit" disabled={busy || !invite.trim()}>Entrar com convite</button>
              </form>
            </div>
            <div className="access-legacy"><p>Tem uma conversa antiga?</p><input aria-label="Código da conversa antiga" value={legacy} onChange={(e) => setLegacy(e.target.value)} maxLength={128} placeholder="Cole o código antigo" /><button type="button" disabled={busy || !legacy.trim()} onClick={() => void runRoomAction("claim")}>Trazer conversa antiga</button></div>
            <details className="access-password">
              <summary>Trocar minha senha</summary>
              <form className="access-form" onSubmit={changeAccountPassword}>
                <label>Senha atual<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label>
                <label>Nova senha<input type="password" autoComplete="new-password" value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} minLength={6} required /></label>
                <button className="access-secondary" type="submit" disabled={busy}>Salvar nova senha</button>
              </form>
            </details>
            {error && <p className="access-feedback error" role="alert">{error}</p>}
            {notice && <p className="access-feedback" role="status">{notice}</p>}
          </section>
        )}
      </div>
    </main>
  );
}
