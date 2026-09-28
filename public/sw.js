self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { return; }
  if (!payload || typeof payload.callId !== "string") return;
  const tag = `call-${payload.callId}`;
  event.waitUntil((async () => {
    if (payload.type === "end" || payload.type === "answered") {
      const notifications = await self.registration.getNotifications({ tag });
      notifications.forEach((notification) => notification.close());
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (windows.some((client) => client.visibilityState === "visible")) return;
      // WebKit exige que cada push em segundo plano resulte em aviso visível.
      await self.registration.showNotification(payload.type === "answered" ? "Chamada atendida" : "Ligação encerrada", {
        body: payload.type === "answered" ? "A chamada foi atendida em outro aparelho." : "A chamada terminou.",
        icon: "/icon",
        tag,
        silent: true,
        data: { url: typeof payload.roomId === "string" ? `/?call=${encodeURIComponent(payload.roomId)}` : "/" },
      });
      return;
    }
    if (payload.type !== "call" || typeof payload.roomId !== "string") return;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.some((client) => client.visibilityState === "visible")) return;
    const name = typeof payload.name === "string" ? payload.name.slice(0, 40) : "Alguém";
    await self.registration.showNotification(`Ligação de ${name}`, {
      body: "Toque para atender no nosso bloco",
      icon: "/icon",
      badge: "/icon",
      tag,
      renotify: true,
      requireInteraction: true,
      data: { url: `/?call=${encodeURIComponent(payload.roomId)}` },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(url.href);
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(url.href);
  })());
});
