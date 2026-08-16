import { describe, expect, it } from "vitest";
import { activityLevel, buildReadingActivity, computeStreaks, dayKey, READ_SECONDS_THRESHOLD } from "./readingActivity";
import type { Paper, PaperDayRead } from "../types";

const paper = (partial: Partial<Paper> & Pick<Paper, "id" | "titleEn">): Paper => ({
  titleZh: "",
  authors: [],
  status: "reading",
  favorite: false,
  tagIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...partial
});

describe("readingActivity", () => {
  it("maps scores to five color levels", () => {
    expect(activityLevel(0)).toBe(0);
    expect(activityLevel(1)).toBe(1);
    expect(activityLevel(2)).toBe(2);
    expect(activityLevel(4)).toBe(3);
    expect(activityLevel(5)).toBe(4);
  });

  it("counts daily additions by createdAt and reads by 5-minute threshold", () => {
    const today = new Date("2026-08-16T12:00:00");
    const papers: Paper[] = [
      paper({ id: "p1", titleEn: "A", createdAt: "2026-08-16T08:00:00.000Z" }),
      paper({ id: "p2", titleEn: "B", createdAt: "2026-08-16T09:00:00.000Z" }),
      paper({ id: "p3", titleEn: "C", createdAt: "2026-08-15T10:00:00.000Z" })
    ];
    const readingDays: PaperDayRead[] = [
      { day: "2026-08-16", paperId: "p1", seconds: READ_SECONDS_THRESHOLD },
      { day: "2026-08-16", paperId: "p2", seconds: READ_SECONDS_THRESHOLD - 1 },
      { day: "2026-08-15", paperId: "p3", seconds: 600 }
    ];
    const result = buildReadingActivity({ papers, readingDays, today, weeks: 2 });
    const byDate = Object.fromEntries(result.days.map(day => [day.date, day]));
    expect(byDate["2026-08-16"].addedCount).toBe(2);
    expect(byDate["2026-08-16"].readCount).toBe(1);
    expect(byDate["2026-08-16"].level).toBe(3);
    expect(byDate["2026-08-15"].addedCount).toBe(1);
    expect(byDate["2026-08-15"].readCount).toBe(1);
    expect(result.checkInDays).toBeGreaterThanOrEqual(2);
    expect(result.totalReads).toBe(2);
  });

  it("computes current and longest streaks from added or read activity", () => {
    const days = [
      { date: "2026-08-13", addedCount: 1, readCount: 0, level: 1 as const },
      { date: "2026-08-14", addedCount: 0, readCount: 1, level: 1 as const },
      { date: "2026-08-15", addedCount: 0, readCount: 0, level: 0 as const },
      { date: "2026-08-16", addedCount: 0, readCount: 1, level: 1 as const }
    ];
    expect(computeStreaks(days, "2026-08-16")).toEqual({ currentStreak: 1, longestStreak: 2 });
    expect(dayKey(new Date(2026, 7, 16))).toBe("2026-08-16");
  });
});
