import { describe, expect, it } from "vitest";
import { connectionUsesNeonHttpApi } from "@/db/connection";

describe("connectionUsesNeonHttpApi", () => {
  it("uses Neon HTTP for Neon hosts", () => {
    expect(
      connectionUsesNeonHttpApi(
        "postgres://user:pass@ep-long-rain-123456.us-east-2.aws.neon.tech/neondb?sslmode=require",
      ),
    ).toBe(true);
  });

  it("uses TCP for local Postgres hosts", () => {
    expect(
      connectionUsesNeonHttpApi("postgres://postgres:postgres@127.0.0.1:5432/intro_builder"),
    ).toBe(false);
  });
});
