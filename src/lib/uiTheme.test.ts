import { describe, expect, it } from "vitest";
import { appearanceFromProfile, applyAppearance, APPEARANCE_OPTIONS } from "./appearance";
import { readFileSync } from "node:fs";

describe("appearance theme unification", () => {
  it("maps profile fields to a single appearance id", () => {
    expect(appearanceFromProfile({ theme: "light", visualTheme: "lilac" })).toBe("lilac-light");
    expect(appearanceFromProfile({ theme: "system" })).toBe("workbench-system");
  });

  it("writes both theme axes from one appearance choice", () => {
    const next = applyAppearance(
      { displayName: "a", researchField: "b", theme: "system", visualTheme: "workbench" },
      "lilac-dark"
    );
    expect(next.theme).toBe("dark");
    expect(next.visualTheme).toBe("lilac");
  });

  it("exposes nine labeled theme options for settings", () => {
    expect(APPEARANCE_OPTIONS).toHaveLength(9);
    expect(APPEARANCE_OPTIONS.some(item => item.label.includes("柔光紫"))).toBe(true);
    expect(APPEARANCE_OPTIONS.some(item => item.label.includes("雾蓝日程"))).toBe(true);
  });
});

describe("ui theme tokens", () => {
  const css = readFileSync("src/styles.css", "utf8");

  it("uses soft sky shell tokens instead of purple accent", () => {
    expect(css).toMatch(/--accent:\s*#1e2f4d/);
    expect(css).toMatch(/--brand:\s*#e85d6a/);
    expect(css).toMatch(/--radius-card:\s*22px/);
    expect(css).not.toMatch(/--accent:\s*#7464c8/);
  });

  it("keeps embedded reader inside the workspace card", () => {
    const readerCss = readFileSync("src/components/PdfReader.css", "utf8");
    expect(readerCss).toMatch(/\.reader-screen\.embedded\s*\{[^}]*position:\s*absolute/);
    expect(readerCss).not.toMatch(/left:\s*224px/);
  });
});

describe("library overview density", () => {
  const css = readFileSync("src/reference-theme.css", "utf8");

  it("scopes workbench overview styles to workbench", () => {
    expect(css).toContain(':root[data-ui-theme="workbench"]');
  });

  it("keeps metric number and label on one row", () => {
    expect(css).toMatch(/\.overview-metrics article div\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.overview-metrics article div\s*\{[^}]*align-items:\s*baseline/);
    expect(css).toMatch(/\.overview-metrics small\s*\{[^}]*font-size:\s*13px/);
  });

  it("uses a compact overview strip padding", () => {
    expect(css).toMatch(/\.research-overview\s*\{[^}]*padding:\s*10px 18px/);
  });

  it("uses flat page headers without nested card seams", () => {
    const base = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.page-heading,\s*\n?\s*\.knowledge-graph-header\s*\{[^}]*background:\s*transparent/);
    expect(base).toMatch(/\.page-title-row/);
    expect(base).toMatch(/\.page-kicker/);
  });
});

describe("visual theme selection", () => {
  it("unifies settings into a single theme control and isolates lilac styles", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const settings = readFileSync("src/components/SettingsView.tsx", "utf8");
    const theme = readFileSync("src/lilac-dashboard-theme.css", "utf8");
    const schema = readFileSync("src-tauri/src/schema.sql", "utf8");

    expect(app).toMatch(/dataset\.uiTheme = data\.profile\.visualTheme \?\? "workbench"/);
    expect(settings).toContain(">主题<");
    expect(settings).not.toContain("明暗主题");
    expect(settings).not.toContain("界面风格");
    expect(settings).toContain("APPEARANCE_OPTIONS");
    expect(readFileSync("src/lib/appearance.ts", "utf8")).toContain("柔光紫仪表盘");
    expect(theme).toContain(':root[data-ui-theme="lilac"]');
    expect(theme).toContain(':root[data-ui-theme="lilac"][data-theme="dark"]');
    expect(theme).toMatch(/\.research-overview\s*\{[^}]*display:\s*grid/);
    expect(schema).toContain('"visualTheme":"workbench"');
  });

  it("keeps lilac warm orchid tokens away from classic blue-grey shell", () => {
    const theme = readFileSync("src/lilac-dashboard-theme.css", "utf8");
    expect(theme).toMatch(/--accent:\s*#7c3aed/);
    expect(theme).toMatch(/--brand:\s*#db6ba3/);
    expect(theme).toMatch(/--app-bg:[\s\S]*#ebe0f6/);
    expect(theme).not.toContain("#e8f1f5");
    expect(theme).not.toContain("#1e2f4d");
    expect(theme).not.toContain("#e85d6a");
    expect(theme).toMatch(/grid-template-columns:\s*232px/);
    expect(theme).not.toMatch(/\.brand div,\s*\n?\s*\.profile-mini,\s*\n?\s*\.theme-switch\s*\{\s*display:\s*none/);
    expect(theme).not.toMatch(/\.sidebar nav button\s*\{[^}]*font-size:\s*0/);
  });

  it("keeps mist theme rules in its own stylesheet", () => {
    const theme = readFileSync("src/mist-dashboard-theme.css", "utf8");

    expect(theme).toContain(':root[data-ui-theme="mist"]');
    expect(theme).toContain(':root[data-ui-theme="mist"][data-theme="dark"]');
    expect(theme).toMatch(/--accent:\s*#596d7f/);
  });
});
