import { afterAll, expect, test } from "bun:test"
import { makeSignature } from "better-auth/crypto"
import { z } from "zod"

process.env.DEMO_DATABASE = ":memory:"
process.env.BETTER_AUTH_URL = "http://localhost:4318"
process.env.BETTER_AUTH_SECRET =
    "local-control-test-secret-with-at-least-32-characters"
delete process.env.AGENTID_CLIENT_ID
delete process.env.AGENTID_CLIENT_SECRET
await import("./setup")
const { auth, database } = await import("./auth")
const { server } = await import("./server")
const origin = "http://localhost:4318"

// Local fixtures exercise real Better Auth sessions and SQLite; they do not test AgentID signup.
async function createFixture() {
    const context = await auth.$context
    const user = await context.internalAdapter.createUser(
        {
            email: `fixture-${crypto.randomUUID()}@example.test`,
            name: "Local control fixture",
        },
        { method: "admin" },
    )
    const session = await context.internalAdapter.createSession(user.id)
    const signature = await makeSignature(session.token, context.secret)
    return {
        user,
        headers: {
            Cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`,
            Origin: origin,
            "Content-Type": "application/json",
        },
    }
}

test.concurrent("unauthenticated search is denied", async () => {
    const response = await fetch(`${origin}/api/search`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "Europe data" }),
    })
    expect(response.status).toBe(401)
})

test.concurrent("a signed-in account can search the actual sample data", async () => {
    const fixture = await createFixture()
    const response = await fetch(`${origin}/api/search`, {
        method: "POST",
        headers: fixture.headers,
        body: JSON.stringify({ query: "Europe data" }),
    })
    const result = z
        .object({ results: z.array(z.object({ name: z.string() })) })
        .parse(await response.json())
    expect(result.results.map((company) => company.name)).toEqual([
        "Northstar Data",
        "Cedar Pipeline",
    ])
})

test.concurrent("concurrent searches cannot overrun the three-search allowance", async () => {
    const fixture = await createFixture()
    const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
            fetch(`${origin}/api/search`, {
                method: "POST",
                headers: fixture.headers,
                body: JSON.stringify({ query: "Europe" }),
            }),
        ),
    )
    expect(responses.map((response) => response.status).sort()).toEqual([
        200, 200, 200, 429, 429, 429, 429, 429, 429, 429,
    ])
})

test.concurrent("suspension blocks the same session while its quota is unused", async () => {
    const fixture = await createFixture()
    const before = await fetch(`${origin}/api/search`, {
        method: "POST",
        headers: fixture.headers,
        body: JSON.stringify({ query: "Europe" }),
    })
    expect(before.status).toBe(200)
    database.transaction(() => {
        database
            .query(
                "UPDATE agent_access SET used = 0, suspended = 1 WHERE user_id = ?",
            )
            .run(fixture.user.id)
        database
            .query('DELETE FROM session WHERE "userId" = ?')
            .run(fixture.user.id)
    })()
    const after = await fetch(`${origin}/api/search`, {
        method: "POST",
        headers: fixture.headers,
        body: JSON.stringify({ query: "Europe" }),
    })
    expect(after.status).toBe(401)
})

test.concurrent("a suspended account remains denied with a new session", async () => {
    const fixture = await createFixture()
    database
        .query("INSERT INTO agent_access (user_id, suspended) VALUES (?, 1)")
        .run(fixture.user.id)
    const response = await fetch(`${origin}/api/search`, {
        method: "POST",
        headers: fixture.headers,
        body: JSON.stringify({ query: "Europe" }),
    })
    expect(response.status).toBe(403)
})

afterAll(() => {
    server.stop(true)
    database.close()
})
