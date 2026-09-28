import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "nosso bloco",
    short_name: "nosso bloco",
    description: "Conversas e chamadas na sala de vocês.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f8f5",
    theme_color: "#203c2a",
    icons: [{ src: "/icon", sizes: "192x192", type: "image/png", purpose: "maskable" }],
  };
}
