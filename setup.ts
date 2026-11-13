import { getMigrations } from "better-auth/db/migration"
import { auth, database } from "./auth"

const { runMigrations } = await getMigrations(auth.options)
await runMigrations()
database.exec(`
  CREATE TABLE IF NOT EXISTS agent_access (
    user_id TEXT PRIMARY KEY,
    used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
    suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1)),
    CONSTRAINT agent_access_user_fk FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    outcome TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT action_log_user_fk FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );
`)
console.log("Local SQLite auth and access tables are ready.")
