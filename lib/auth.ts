export function requireSiteUser(request: Request) {
  const userId = request.headers.get("oai-authenticated-user-id");
  if (userId) return { userId, email: request.headers.get("oai-authenticated-user-email") };

  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return { userId: "local-preview", email: "local@preview" };
  }

  throw new Response("Authentication required", { status: 401 });
}
