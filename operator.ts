import { z } from "zod"
import { database } from "./auth"

const command = z
    .enum(["list", "reset", "suspend", "resume"])
    .parse(process.argv[2])
if (command === "list") {
    console.table(
        database
            .query(`SELECT u.id, u.email, COALESCE(a.used, 0) used,
    COALESCE(a.suspended, 0) suspended FROM user u LEFT JOIN agent_access a ON a.user_id = u.id`)
            .all(),
    )
} else {
    const userId = z.string().min(1).parse(process.argv[3])
    if (!database.query("SELECT id FROM user WHERE id = ?").get(userId))
        throw new Error("Unknown user")
    database.transaction(() => {
        database
            .query("INSERT OR IGNORE INTO agent_access (user_id) VALUES (?)")
            .run(userId)
        if (command === "reset")
            database
                .query("UPDATE agent_access SET used = 0 WHERE user_id = ?")
                .run(userId)
        if (command === "resume")
            database
                .query(
                    "UPDATE agent_access SET suspended = 0 WHERE user_id = ?",
                )
                .run(userId)
        if (command === "suspend") {
            database
                .query(
                    "UPDATE agent_access SET suspended = 1 WHERE user_id = ?",
                )
                .run(userId)
            database.query('DELETE FROM session WHERE "userId" = ?').run(userId)
        }
        database
            .query(
                "INSERT INTO action_log (user_id, action, outcome) VALUES (?, ?, 'operator')",
            )
            .run(userId, command)
    })()
    console.log(`${command}: ${userId}`)
}
