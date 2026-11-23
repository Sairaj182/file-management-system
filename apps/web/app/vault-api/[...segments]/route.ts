import { upstream } from "../../../lib/upstream";

const allowed =
  /^(?:auth\/(?:sign-in\/email|sign-out)|users|dockyard(?:\/[\w-]+(?:\/members(?:\/[\w-]+)?|\/files(?:\/[\w-]+(?:\/(?:download|verify|signed-url))?)?|\/api-keys(?:\/[\w-]+(?:\/rotate)?)?)?)?)$/;

async function forward(
  request: Request,
  context: { params: Promise<{ segments: string[] }> },
) {
  const { segments } = await context.params;
  const path = segments.join("/");
  if (!allowed.test(path)) return new Response(null, { status: 404 });
  if (path === "users" && request.method !== "POST") {
    return new Response(null, { status: 405 });
  }
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const write = request.method !== "GET";
  const dashboardOrigin = new URL(
    process.env.WEB_ORIGIN ||
      `http://localhost:${process.env.PORT_WEB ?? 3000}`,
  ).origin;
  if (write && origin !== dashboardOrigin)
    return Response.json({ error: "Request origin rejected" }, { status: 403 });

  const headers = new Headers();
  for (const name of ["cookie", "content-type", "origin"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
    };
    if (write && request.body) {
      init.body = request.body;
      init.duplex = "half";
    }
    const response = await fetch(upstream("/" + path + url.search), init);
    const outgoing = new Headers({
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    for (const name of ["content-type", "content-disposition"]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    for (const cookie of response.headers.getSetCookie())
      outgoing.append("set-cookie", cookie);
    if (path === "auth/sign-in/email" && response.ok) {
      await response.body?.cancel();
      outgoing.delete("content-type");
      return new Response(null, { status: 204, headers: outgoing });
    }
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      { error: "VaultFS API is unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}

export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
