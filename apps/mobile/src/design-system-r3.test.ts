import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/.test(entry)
        ? [path]
        : [];
  });
}

describe("Proxy Design System R3 typography", () => {
  it("keeps readable UI text at 11pt or larger", () => {
    const violations = ["components", "surfaces"].flatMap((directory) =>
      sourceFiles(join(sourceRoot, directory)).flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return [...source.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)]
          .filter((match) => Number(match[1]) < 11)
          .map((match) => `${path.slice(sourceRoot.length + 1)}:${match.index}:${match[0]}`);
      })
    );

    expect(violations).toEqual([]);
  });
});
