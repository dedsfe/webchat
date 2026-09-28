import { authenticatedUser, json, serverConfig, webpush } from "../push/server";

export const runtime = "nodejs";

type Subscription = { endpoint: string; p256dh: string; auth_key: string; caller_name?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const config = serverConfig();
  if (!config) return json({ error: "Push não configurado" }, 503);
  const user = await authenticatedUser(request, config.auth);
  if (!user) return json({ error: "Sessão inválida" }, 401);
  const body = await request.json().catch(() => null) as { event?: unknown; callId?: unknown; roomId?: unknown } | null;
  if ((body?.event !== "start" && body?.event !== "end") || typeof body.callId !== "string" || !uuid.test(body.callId) ||
      typeof body.roomId !== "string" || body.roomId.length > 128) return json({ error: "Chamada inválida" }, 400);

  const rpc = body.event === "start" ? "call_push_start" : "call_push_end";
  const { data, error } = await config.databaseFor(request).rpc(rpc, {
    p_secret: config.secret, p_call_id: body.callId, p_room_id: body.roomId,
  });
  if (error) return json({ error: "Não foi possível avisar a chamada" }, 403);
  const subscriptions = data as Subscription[] | null;
  await Promise.all((subscriptions || []).map(async (subscription) => {
    const payload = body.event === "start"
      ? { type: "call", callId: body.callId, roomId: body.roomId, name: subscription.caller_name }
      : { type: "end", callId: body.callId, roomId: body.roomId };
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: {
        p256dh: subscription.p256dh, auth: subscription.auth_key,
      } }, JSON.stringify(payload), { TTL: body.event === "start" ? 45 : 60, urgency: "high" });
    } catch (pushError) {
      const status = (pushError as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await config.databaseFor(request).rpc("call_push_remove_expired", {
        p_secret: config.secret, p_endpoint: subscription.endpoint,
      });
    }
  }));
  return json({ ok: true });
}
