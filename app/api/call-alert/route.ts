import { authenticatedUser, json, serverConfig, webpush } from "../push/server";

export const runtime = "nodejs";

type Alert = { id: string; room_id: string; caller_id: string; target_id: string; created_at: string; ended_at: string | null };
type Subscription = { endpoint: string; p256dh: string; auth: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const config = serverConfig();
  if (!config) return json({ error: "Push não configurado" }, 503);
  const user = await authenticatedUser(request, config.auth);
  if (!user) return json({ error: "Sessão inválida" }, 401);
  const body = await request.json().catch(() => null) as { event?: unknown; callId?: unknown; roomId?: unknown } | null;
  if ((body?.event !== "start" && body?.event !== "end") || typeof body.callId !== "string" || !uuid.test(body.callId) ||
      typeof body.roomId !== "string" || body.roomId.length > 128) return json({ error: "Chamada inválida" }, 400);

  const { data: members, error: membersError } = await config.admin.from("room_members")
    .select("user_id,display_name").eq("room_id", body.roomId);
  if (membersError) return json({ error: "Não foi possível verificar a sala" }, 500);
  if (members?.length !== 2 || !members.some((member) => member.user_id === user.id)) return json({ error: "Sala inválida" }, 403);

  let alert: Alert | null = null;
  if (body.event === "start") {
    const caller = members.find((member) => member.user_id === user.id)!;
    const target = members.find((member) => member.user_id !== user.id)!;
    const recent = new Date(Date.now() - 45_000).toISOString();
    const { data: active } = await config.admin.from("call_push_alerts").select("id")
      .eq("room_id", body.roomId).eq("caller_id", user.id).is("ended_at", null).gte("created_at", recent).limit(1);
    if (active?.length) return json({ ok: true, skipped: true });
    const { data, error } = await config.admin.from("call_push_alerts").insert({
      id: body.callId, room_id: body.roomId, caller_id: user.id, target_id: target.user_id,
    }).select().single();
    if (error) return json({ error: "Não foi possível registrar a chamada" }, 500);
    alert = data as Alert;
    await deliver(config.admin, alert.target_id, {
      type: "call", callId: alert.id, roomId: alert.room_id, name: caller.display_name,
    });
  } else {
    const { data, error } = await config.admin.from("call_push_alerts").select("*")
      .eq("id", body.callId).eq("room_id", body.roomId).maybeSingle();
    if (error) return json({ error: "Não foi possível verificar a chamada" }, 500);
    alert = data as Alert | null;
    if (!alert || (alert.caller_id !== user.id && alert.target_id !== user.id)) return json({ error: "Chamada inválida" }, 403);
    if (alert.ended_at) return json({ ok: true });
    await config.admin.from("call_push_alerts").update({ ended_at: new Date().toISOString() }).eq("id", alert.id);
    await deliver(config.admin, alert.target_id, { type: "end", callId: alert.id });
  }
  return json({ ok: true });
}

async function deliver(admin: NonNullable<ReturnType<typeof serverConfig>>["admin"], userId: string, payload: object) {
  const { data } = await admin.from("call_push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", userId);
  await Promise.all((data as Subscription[] | null || []).map(async (subscription) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: {
        p256dh: subscription.p256dh, auth: subscription.auth,
      } }, JSON.stringify(payload), { TTL: payload && "roomId" in payload ? 45 : 60, urgency: "high" });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await admin.from("call_push_subscriptions").delete().eq("endpoint", subscription.endpoint);
    }
  }));
}
