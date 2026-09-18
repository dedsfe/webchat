import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "URL é obrigatória" }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return NextResponse.json({ error: "Protocolo inválido" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, "");
  const favicon = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json({
        url: targetUrl,
        siteName: hostname,
        favicon,
      });
    }

    const html = await response.text();

    // Helper para extrair metatags via regex
    function getMeta(property: string, name?: string): string | undefined {
      const regexProp = new RegExp(
        `<meta[^>]+(?:property|name)=["'](?:og:|twitter:)?${property}["'][^>]+content=["']([^"']+)["']`,
        "i"
      );
      const regexAlt = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:|twitter:)?${property}["']`,
        "i"
      );
      const match = html.match(regexProp) || html.match(regexAlt);
      if (match && match[1]) return decodeHtml(match[1].trim());

      if (name) {
        const regexName = new RegExp(
          `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
          "i"
        );
        const matchName = html.match(regexName);
        if (matchName && matchName[1]) return decodeHtml(matchName[1].trim());
      }
      return undefined;
    }

    function decodeHtml(str: string): string {
      return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, " ");
    }

    // Título
    let title = getMeta("title") || getMeta("title", "title");
    if (!title) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) title = decodeHtml(titleMatch[1].trim());
    }

    // Descrição
    const description = getMeta("description", "description");

    // Imagem de capa
    let image = getMeta("image");
    if (image) {
      try {
        // Resolve caminhos relativos
        image = new URL(image, parsedUrl.origin).toString();
      } catch {
        image = undefined;
      }
    }

    // Nome do site
    const siteName = getMeta("site_name") || hostname;

    return NextResponse.json({
      url: targetUrl,
      title: title || undefined,
      description: description || undefined,
      image: image || undefined,
      siteName,
      favicon,
    });
  } catch {
    // Fallback gracioso com hostname e favicon se der erro no fetch do site
    return NextResponse.json({
      url: targetUrl,
      siteName: hostname,
      favicon,
    });
  }
}
