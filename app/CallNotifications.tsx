"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

type Props = { client: SupabaseClient; user: User };

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function authorizedFetch(client: SupabaseClient, method: "PUT" | "DELETE", body: object) {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error("Entre na sua conta para ativar os avisos.");
  const response = await fetch("/api/push", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Não foi possível salvar os avisos. Tente novamente.");
}

export async function removeCallPushSubscription(client: SupabaseClient) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await authorizedFetch(client, "DELETE", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

export default function CallNotifications({ client, user }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const keyRef = useRef("");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    let alive = true;
    void Promise.all([
      navigator.serviceWorker.register("/sw.js"),
      fetch("/api/push").then((response) => response.ok ? response.json() : null),
    ]).then(async ([registration, config]) => {
      if (!alive) return;
      registrationRef.current = registration;
      keyRef.current = config?.publicKey || "";
      const subscription = await registration.pushManager.getSubscription();
      if (!alive || !subscription) return;
      setEnabled(true);
      try { await authorizedFetch(client, "PUT", subscription.toJSON()); } catch { /* próxima ativação tentará de novo */ }
    }).catch(() => {});
    return () => { alive = false; };
  }, [client, user.id]);

  async function toggle() {
    if (busy) return;
    setMessage("");
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setMessage("Este navegador não permite avisos de chamadas.");
      return;
    }
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches &&
        !(navigator as Navigator & { standalone?: boolean }).standalone) {
      setMessage("No iPhone, adicione o nosso bloco à Tela de Início para receber chamadas.");
      return;
    }
    if (!enabled && !keyRef.current) {
      setMessage("Avisos ainda não estão configurados ou estão sendo preparados.");
      return;
    }
    const permissionRequest = !enabled && Notification.permission === "default" ? Notification.requestPermission() : null;
    setBusy(true);
    try {
      const registration = registrationRef.current || await navigator.serviceWorker.register("/sw.js");
      registrationRef.current = registration;
      const existing = await registration.pushManager.getSubscription();
      if (enabled && existing) {
        await authorizedFetch(client, "DELETE", { endpoint: existing.endpoint });
        await existing.unsubscribe();
        setEnabled(false);
        setMessage("Avisos de chamadas desativados neste aparelho.");
        return;
      }
      if (!keyRef.current) throw new Error("Avisos ainda não estão configurados.");
      if (Notification.permission === "denied") throw new Error("Permita notificações nas configurações do navegador.");
      if (permissionRequest) {
        const permission = await permissionRequest;
        if (permission !== "granted") throw new Error("Permissão para notificações não concedida.");
      }
      // A inscrição é iniciada pelo clique: exigência dos navegadores móveis.
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: decodeKey(keyRef.current),
      });
      await authorizedFetch(client, "PUT", subscription.toJSON());
      setEnabled(true);
      setMessage("Avisos de chamadas ativados neste aparelho.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível ativar os avisos.");
    } finally { setBusy(false); }
  }

  return <>
    <button type="button" className={`btn-header-acao call-alert-toggle ${enabled ? "is-enabled" : ""}`}
      onClick={() => void toggle()} disabled={busy}
      aria-label={enabled ? "Desativar avisos de chamadas" : "Ativar avisos de chamadas"}
      title={enabled ? "Avisos de chamadas ativados. Toque para desativar." : "Ativar avisos de chamadas"}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4" />
      </svg>
    </button>
    {message && <div className="call-alert-message" role="status" onClick={() => setMessage("")}>{message}</div>}
  </>;
}
