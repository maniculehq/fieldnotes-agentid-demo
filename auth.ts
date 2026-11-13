import { Database } from "bun:sqlite"
import { agentid } from "@agentmail/agentid-better-auth"
import { betterAuth } from "better-auth"
import { genericOAuth } from "better-auth/plugins/generic-oauth"
import { z } from "zod"

const env = z
    .object({
        BETTER_AUTH_URL: z.url().default("http://localhost:4317"),
        BETTER_AUTH_SECRET: z.string().min(32),
        AGENTID_CLIENT_ID: z.string().optional(),
        AGENTID_CLIENT_SECRET: z.string().optional(),
        DEMO_DATABASE: z.string().default("./demo.sqlite"),
    })
    .parse(process.env)

export const database = new Database(env.DEMO_DATABASE, { create: true })
database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
export const providerConfigured = Boolean(
    env.AGENTID_CLIENT_ID && env.AGENTID_CLIENT_SECRET,
)
export const auth = betterAuth({
    appName: "Fieldnotes AgentID experiment",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database,
    session: { cookieCache: { enabled: false } },
    plugins: [
        genericOAuth({
            config:
                env.AGENTID_CLIENT_ID && env.AGENTID_CLIENT_SECRET
                    ? [
                          agentid({
                              clientId: env.AGENTID_CLIENT_ID,
                              clientSecret: env.AGENTID_CLIENT_SECRET,
                              scopes: [
                                  "openid",
                                  "email",
                                  "profile",
                                  "owner_profile",
                                  "owner_email",
                              ],
                          }),
                      ]
                    : [],
        }),
    ],
    onAPIError: { errorURL: "/sign-in-failed" },
})
