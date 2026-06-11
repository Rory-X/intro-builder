import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("fumadocs build preparation", () => {
  it("generates collections before every web production build", () => {
    const packagePath = path.join(process.cwd(), "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.prebuild).toBe("fumadocs-mdx");
    expect(packageJson.scripts?.build).toBe("next build --webpack");
  });
});
