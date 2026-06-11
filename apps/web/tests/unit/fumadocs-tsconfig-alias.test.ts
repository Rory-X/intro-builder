import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("fumadocs generated collection alias", () => {
  it("maps collections/* to the generated .source directory", () => {
    const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8")) as {
      compilerOptions?: {
        paths?: Record<string, string[]>;
      };
    };

    expect(tsconfig.compilerOptions?.paths?.["collections/*"]).toEqual([
      "./.source/*",
    ]);
  });

  it("imports generated collections without suppressing type errors", () => {
    const sourcePath = path.join(process.cwd(), "lib/source.ts");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toContain("@ts-expect-error");
    expect(source).toContain('from "collections/server"');
  });
});
