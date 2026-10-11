import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join } from "path";

/**
 * The Expo member app lives in `mobile/` as one repository, and that only works while
 * the two projects stay strangers.
 *
 * Two things go wrong if the boundary is not pinned. The obvious one: the root
 * `tsconfig.json` includes every TypeScript file in the repository, so React Native's
 * types would be pulled into
 * `npm run typecheck` and the backend's gate would start depending on `mobile/node_modules`
 * existing. The quieter one: `next lint` walks the project root, so app files would be
 * judged by `next/core-web-vitals` rules that mean nothing there, and someone would
 * rewrite app code to satisfy a web linter.
 *
 * So the exclusion is asserted here, in the same suite that guards everything else about
 * this repository, and the direction of dependency is asserted too — the backend never
 * imports the app, and the app never reaches an admin route.
 */

const ROOT = process.cwd();
const MOBILE = join(ROOT, "mobile");

function walk(dir: string, match: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === ".expo" || entry === "android" || entry === "dist") return [];
      return walk(path, match);
    }
    return match(entry) ? [path] : [];
  });
}

const appFiles = walk(MOBILE, (name) => /\.(ts|tsx)$/.test(name));
const backendSource = walk(join(ROOT, "src"), (name) => /\.(ts|tsx)$/.test(name));

describe("mobile/ stays a separate project inside one repository", () => {
  it("exists as a real Expo project, not a stub", () => {
    expect(existsSync(join(MOBILE, "package.json"))).toBe(true);
    expect(existsSync(join(MOBILE, "app.config.ts"))).toBe(true);
    expect(existsSync(join(MOBILE, "tsconfig.json"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(MOBILE, "package.json"), "utf8")) as { main?: string };
    expect(pkg.main).toBe("expo-router/entry");
    // The check is only meaningful if there is something in it to exclude.
    expect(appFiles.length).toBeGreaterThan(20);
  });

  it("keeps the app out of the backend's typecheck", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8").replace(/\/\/.*$/gm, "")) as {
      include?: string[];
      exclude?: string[];
    };
    const exclude = config.exclude ?? [];
    const coversMobile = exclude.some(
      (pattern) => pattern === "mobile" || pattern === "mobile/**" || pattern === "./mobile" || pattern === "./mobile/**",
    );
    expect(coversMobile, `root tsconfig exclude must cover mobile/, got ${JSON.stringify(exclude)}`).toBe(true);
    // And the include really is the greedy one that makes the exclusion necessary.
    expect(config.include ?? []).toContain("**/*.ts");
  });

  it("keeps the app out of next lint", () => {
    const eslint = JSON.parse(readFileSync(join(ROOT, ".eslintrc.json"), "utf8").replace(/\/\/.*$/gm, "")) as {
      ignorePatterns?: string[];
    };
    const patterns = eslint.ignorePatterns ?? [];
    expect(patterns.some((p) => p.startsWith("mobile"))).toBe(true);
  });

  it("carries its own ignores for node_modules, env files and signing material", () => {
    const ignore = readFileSync(join(MOBILE, ".gitignore"), "utf8");
    for (const needle of ["node_modules", ".env", "/android", "*.keystore", ".expo"]) {
      expect(ignore, `mobile/.gitignore should ignore ${needle}`).toContain(needle);
    }
  });

  it("ships the env template with the one variable the app cannot run without", () => {
    const example = readFileSync(join(MOBILE, ".env.example"), "utf8");
    expect(example).toContain("EXPO_PUBLIC_API_URL");
  });
});

describe("the dependency only points one way", () => {
  it("no backend file imports anything from the app", () => {
    /**
     * Only a specifier that walks *into* the app directory counts. `src/lib/mobile-auth.ts`
     * importing `@/lib/mobile-handoff` is the backend talking to itself, and a looser rule
     * would flag it — which is how a boundary test ends up being edited to pass.
     */
    const reachesIntoApp = (source: string) =>
      [...source.matchAll(/from\s+["']([^"']+)["']/g)]
        .map((match) => match[1])
        .some((spec) => /(^|\/)mobile\//.test(spec));
    const offenders = backendSource
      .filter((path) => reachesIntoApp(readFileSync(path, "utf8")))
      .map((path) => path.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it("the app imports no backend module and no Next.js runtime", () => {
    const offenders = appFiles
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        // `@/` is the backend's alias; mobile has no path alias of its own, so any
        // hit here means somebody reached across the boundary. `next/` would be worse:
        // it does not exist in the app's dependency tree at all.
        return /from\s+["@'](?:\/|next\/|@\/)/.test(source) || /require\(["']next\//.test(source);
      })
      .map((path) => path.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  /**
   * The strongest thing here: this app is a *member* client. Every URL it can build is
   * relative to the member API, so an admin path appearing anywhere in it would mean the
   * mobile client was pointed at a staff surface it has no business calling.
   */
  it("never reaches for an admin endpoint", () => {
    const services = appFiles.filter((path) => path.includes("/services/") || path.includes("\\services\\"));
    expect(services.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const path of services) {
      const source = readFileSync(path, "utf8");
      for (const [, , quoted] of source.matchAll(/(["'`])((?:\/api|https?:\/\/)[^"'`]*)\1/g)) {
        if (quoted.includes("/admin")) hits.push(`${path.slice(ROOT.length + 1)} → ${quoted}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
