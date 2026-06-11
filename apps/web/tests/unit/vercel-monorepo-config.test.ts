import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readJson<T>(relativePath: string): T {
  const filePath = path.join(process.cwd(), "..", "..", relativePath);
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

describe("Vercel monorepo configuration", () => {
  it("lets the Next.js framework preset collect the deployment output", () => {
    const vercelConfig = readJson<{
      framework?: string;
      outputDirectory?: string;
    }>("vercel.json");

    expect(vercelConfig.framework).toBe("nextjs");
    expect(vercelConfig.outputDirectory).toBeUndefined();
  });

  it("keeps the root Next.js detector version aligned with the web app", () => {
    const rootPackage = readJson<{
      devDependencies?: Record<string, string>;
    }>("package.json");
    const webPackage = readJson<{
      dependencies?: Record<string, string>;
    }>("apps/web/package.json");

    expect(rootPackage.devDependencies?.next).toBe(
      webPackage.dependencies?.next,
    );
  });
});
