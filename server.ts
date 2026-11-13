import { z } from "zod"
import { auth, database, providerConfigured } from "./auth"
import companies from "./dataset.json"

const accessSchema = z.object({ used: z.number(), suspended: z.number() })
const claimsSchema = z.object({
    sub: z.string(),
    email: z.email(),
    email_verified: z.boolean().optional(),
    name: z.string().optional(),
    owner_sub: z.string().optional(),
    owner_name: z.string().optional(),
    owner_email: z.email().optional(),
    owner_email_verified: z.boolean().optional(),
    owner_human_verified: z.boolean().optional(),
    owner_human_id: z.string().optional(),
})

export const server = Bun.serve({
    hostname: "127.0.0.1",
    port: Number(
        new URL(auth.options.baseURL ?? "http://localhost:4317").port || 4317,
    ),
    async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname.startsWith("/api/auth/")) return auth.handler(request)
        if (url.pathname === "/")
            return new Response(
                Bun.file(new URL("./index.html", import.meta.url)),
            )
        if (url.pathname === "/api/status")
            return Response.json({ providerConfigured, quota: 3 })
        if (url.pathname === "/sign-in-failed") {
            return new Response(
                `Sign-in failed: ${url.searchParams.get("error") ?? "unknown"}. Check the server log.`,
                { status: 400 },
            )
        }
        if (url.pathname === "/login/agentid" && request.method === "GET") {
            if (!providerConfigured)
                return Response.json(
                    { error: "provider_not_configured" },
                    { status: 503 },
                )
            const result = await auth.api.signInSocial({
                body: {
                    provider: "agentid",
                    callbackURL: "/",
                    loginHint: url.searchParams.get("login_hint") ?? undefined,
                },
                headers: request.headers,
                returnHeaders: true,
            })
            const location = z.url().parse(result.response.url)
            const headers = new Headers({ Location: location })
            for (const cookie of result.headers.getSetCookie())
                headers.append("Set-Cookie", cookie)
            return new Response(null, { status: 302, headers })
        }
        if (!["/api/me", "/api/search"].includes(url.pathname))
            return new Response("Not found", { status: 404 })
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session)
            return Response.json({ error: "sign_in_required" }, { status: 401 })
        database
            .query("INSERT OR IGNORE INTO agent_access (user_id) VALUES (?)")
            .run(session.user.id)
        const access = accessSchema.parse(
            database
                .query(
                    "SELECT used, suspended FROM agent_access WHERE user_id = ?",
                )
                .get(session.user.id),
        )
        if (access.suspended)
            return Response.json(
                { error: "account_suspended" },
                { status: 403 },
            )
        if (url.pathname === "/api/me") {
            let identity: z.infer<typeof claimsSchema> | null = null
            const linked = z
                .object({ id: z.string() })
                .nullable()
                .parse(
                    database
                        .query(
                            "SELECT id FROM account WHERE providerId = 'agentid' AND userId = ?",
                        )
                        .get(session.user.id),
                )
            if (linked) {
                const { accessToken } = await auth.api.getAccessToken({
                    body: { accountId: linked.id },
                    headers: request.headers,
                })
                const response = await fetch(
                    "https://auth.agentid.com/v0/userinfo",
                    { headers: { Authorization: `Bearer ${accessToken}` } },
                )
                if (!response.ok)
                    return Response.json(
                        { error: "identity_fetch_failed" },
                        { status: 502 },
                    )
                identity = claimsSchema.parse(await response.json())
            }
            return Response.json({
                user: {
                    id: session.user.id,
                    name: session.user.name,
                    email: session.user.email,
                },
                identity,
                used: access.used,
                quota: 3,
                source: linked ? "live-agentid" : "local-control-test-fixture",
            })
        }
        if (request.method !== "POST")
            return new Response("Method not allowed", { status: 405 })
        if (request.headers.get("origin") !== auth.options.baseURL)
            return Response.json({ error: "invalid_origin" }, { status: 403 })
        const input = z
            .object({ query: z.string().trim().min(1).max(120) })
            .safeParse(await request.json().catch(() => null))
        if (!input.success)
            return Response.json({ error: "invalid_query" }, { status: 400 })
        const allowed = database.transaction(() => {
            const changed = database
                .query(
                    "UPDATE agent_access SET used = used + 1 WHERE user_id = ? AND suspended = 0 AND used < 3",
                )
                .run(session.user.id)
            database
                .query(
                    "INSERT INTO action_log (user_id, action, outcome) VALUES (?, 'search', ?)",
                )
                .run(
                    session.user.id,
                    changed.changes ? "allowed" : "quota_exhausted",
                )
            return changed.changes > 0
        })()
        if (!allowed)
            return Response.json(
                {
                    error: "quota_exhausted",
                    message: "The three-search demo allowance is exhausted.",
                },
                { status: 429 },
            )
        const terms = input.data.query.toLowerCase().split(/\s+/)
        const results = companies.filter((company) =>
            terms.every((term) =>
                `${company.name} ${company.sector} ${company.region}`
                    .toLowerCase()
                    .includes(term),
            ),
        )
        return Response.json({
            query: input.data.query,
            results,
            message: `${results.length} matching sample companies`,
        })
    },
})
console.log(
    `Fieldnotes experiment listening at ${auth.options.baseURL}; AgentID ${providerConfigured ? "configured" : "awaiting registration"}`,
)
