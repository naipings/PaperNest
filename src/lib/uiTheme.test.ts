import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
    expect(css).toMatch(/\.page-heading,\s*\n?\.knowledge-graph-header\s*\{[^}]*background:\s*transparent/);
    expect(base).toMatch(/\.page-title-row/);
    expect(base).toMatch(/\.page-kicker/);
  });
});

describe("visual theme selection", () => {
  it("persists and applies the lilac dashboard selection", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const settings = readFileSync("src/components/SettingsView.tsx", "utf8");
    const theme = readFileSync("src/lilac-dashboard-theme.css", "utf8");
    const schema = readFileSync("src-tauri/src/schema.sql", "utf8");

    expect(app).toMatch(/dataset\.uiTheme = data\.profile\.visualTheme \?\? "workbench"/);
    expect(settings).toContain("柔光紫仪表盘");
    expect(theme).toContain(':root[data-ui-theme="lilac"]');
    expect(schema).toContain('"visualTheme":"workbench"');
  });
});
