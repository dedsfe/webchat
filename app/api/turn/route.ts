import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function json(data: object, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

type IceServer = { urls: string | string[]; username?: string; credential?: string };

// Credenciais TURN temporárias. Cloudflare Realtime TURN se configurado; senão um TURN fixo (ex.: metered.ca).
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const header = request.headers.get("authorization") || "";
  if (!url || !anon || !header.startsWith("Bearer ")) return json({ error: "Sessão inválida" }, 401);
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await auth.auth.getUser(header.slice(7));
  if (error) return json({ error: "Sessão inválida" }, 401);

  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (keyId && token) {
    try {
      const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 86400 }),
      });
      const body = await response.json() as { iceServers?: IceServer | IceServer[] };
      if (response.ok && body.iceServers) {
        const servers = (Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers]).map((server) => ({
          ...server,
          // Navegadores bloqueiam a porta 53; a própria Cloudflare recomenda remover.
          urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((item) => !/:53(\?|$)/.test(item)),
        })).filter((server) => server.urls.length);
        return json({ iceServers: servers });
      }
    } catch { /* cai para o TURN fixo ou só STUN */ }
  }

  const urls = process.env.TURN_URLS?.split(",").map((item) => item.trim()).filter(Boolean);
  if (urls?.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    return json({ iceServers: [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
      { urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL },
    ] });
  }
  return json({ error: "TURN não configurado" }, 503);
}
