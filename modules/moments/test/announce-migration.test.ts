/**
 * Migration 010 (#780): it adds the placement and the icons, and fills the placement of the rows
 * stored before it from `full_screen`, so an urgent one that was in the rail stays there.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "@canccu/kit";
import { MIGRATIONS_DIR } from "../src/db.js";
import { DATABASE_URL, freshDatabase } from "./helpers.js";

const FILE = "010_announcement_look.sql";

describe.skipIf(!DATABASE_URL)("migration 010", () => {
  it("adds columns only: no drop, rename or type change", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, FILE), "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(DROP|RENAME|TYPE)\b/i);
    expect(sql.match(/ADD COLUMN/gi)).toHaveLength(3);
  });

  it("fills placement from full_screen for the rows stored before it", async () => {
    await (await freshDatabase()).end();
    const admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    try {
      // Back to the database as it was before 010, with two urgent rows stored.
      await admin.query(
        `ALTER TABLE moments_announcements DROP COLUMN placement, DROP COLUMN icon`,
      );
      await admin.query(`ALTER TABLE moments_announcement_templates DROP COLUMN icon`);
      await admin.query(`DELETE FROM moments_migrations WHERE name = $1`, [FILE]);
      for (const [id, full] of [
        ["an_rail", false],
        ["an_full", true],
      ] as const) {
        await admin.query(
          `INSERT INTO moments_announcements (tenant_id, id, status, level, full_screen, title_text,
             body_text, variables, channels, zones, duration_seconds, "when", event_name, time_zone,
             created_at)
           VALUES ('demo', $1, 'ended', 'urgent', $2, 't', '', '{}', '{}', '{}', 300,
             '{"mode":"now"}', 'Demo Event', 'UTC', now())`,
          [id, full],
        );
      }
      await runMigrations(admin, MIGRATIONS_DIR, { ledger: "moments_migrations", lock: 3 });
      const { rows } = await admin.query(
        `SELECT id, placement, icon FROM moments_announcements ORDER BY id`,
      );
      expect(rows).toEqual([
        { id: "an_full", placement: "full", icon: null },
        { id: "an_rail", placement: "rail", icon: null },
      ]);
    } finally {
      await admin.end();
    }
  });
});
