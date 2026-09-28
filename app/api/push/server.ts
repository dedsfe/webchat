import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

export function serverConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.PUSH_SERVER_SECRET;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!url || !anon || !secret || !publicKey || !privateKey || !subject) return null;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return {
    publicKey,
    secret,
    databaseFor: (request: Request) => createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: request.headers.get("authorization") || "" } },
    }),
    auth: createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

export async function authenticatedUser(request: Request, auth: SupabaseClient) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const { data, error } = await auth.auth.getUser(header.slice(7));
  return error ? null : data.user;
}

export function json(data: object, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export { webpush };
