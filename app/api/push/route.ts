import { authenticatedUser, json, serverConfig } from "./server";

export const runtime = "nodejs";

type PushBody = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

export async function GET() {
  const config = serverConfig();
  return config ? json({ publicKey: config.publicKey }) : json({ error: "Push não configurado" }, 503);
}

export async function PUT(request: Request) {
  const config = serverConfig();
  if (!config) return json({ error: "Push não configurado" }, 503);
  const user = await authenticatedUser(request, config.auth);
  if (!user) return json({ error: "Sessão inválida" }, 401);
  const body = await request.json().catch(() => null) as PushBody | null;
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (typeof endpoint !== "string" || endpoint.length > 2048 ||
      typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{40,200}$/.test(p256dh) ||
      typeof auth !== "string" || !/^[A-Za-z0-9_-]{10,100}$/.test(auth)) {
    return json({ error: "Assinatura inválida" }, 400);
  }
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password) return json({ error: "Endpoint inválido" }, 400);
  } catch { return json({ error: "Endpoint inválido" }, 400); }
  const { error } = await config.databaseFor(request).rpc("call_push_subscription", {
    p_secret: config.secret, p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_remove: false,
  });
  return error ? json({ error: "Não foi possível ativar as notificações" }, 500) : json({ ok: true });
}

export async function DELETE(request: Request) {
  const config = serverConfig();
  if (!config) return json({ error: "Push não configurado" }, 503);
  const user = await authenticatedUser(request, config.auth);
  if (!user) return json({ error: "Sessão inválida" }, 401);
  const body = await request.json().catch(() => null) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string") return json({ error: "Endpoint inválido" }, 400);
  const { error } = await config.databaseFor(request).rpc("call_push_subscription", {
    p_secret: config.secret, p_endpoint: body.endpoint, p_p256dh: "", p_auth: "", p_remove: true,
  });
  return error ? json({ error: "Não foi possível desativar as notificações" }, 500) : json({ ok: true });
}
