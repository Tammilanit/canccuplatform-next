import { describe, expect, it } from "vitest";
import { requireTestDatabase } from "../src/testing.js";

/** A client connected to `name`, as Postgres answers current_database(). */
function connectedTo(name: string | null) {
  const asked: string[] = [];
  return {
    asked,
    query(text: string) {
      asked.push(text);
      return Promise.resolve({ rows: name === null ? [] : [{ name }] });
    },
  };
}

describe("requireTestDatabase", () => {
  it("passes a database whose name ends in _test, asking the server, not the URL", async () => {
    const client = connectedTo("canccu_test");
    await expect(requireTestDatabase(client)).resolves.toBeUndefined();
    expect(client.asked).toEqual(["SELECT current_database() AS name"]);
  });

  it.each(["canccu", "postgres", "test_canccu", "canccu_test_old", "canccu_TEST"])(
    "refuses %s",
    async (name) => {
      await expect(requireTestDatabase(connectedTo(name))).rejects.toThrow(
        new RegExp(`"${name}".*ends in _test`),
      );
    },
  );

  it("refuses when the server names no database", async () => {
    await expect(requireTestDatabase(connectedTo(null))).rejects.toThrow(/""/);
  });
});
