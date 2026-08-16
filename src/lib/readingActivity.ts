import type { Paper, PaperDayRead } from "../types";

/** 同一天在阅读台累计满 5 分钟，该论文才计入「阅读」 */
export const READ_SECONDS_THRESHOLD = 300;

export type DayActivity = {
  date: string;
  addedCount: number;
  readCount: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export const dayKey = (value: string | Date) => {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function dayActive(day: DayActivity) {
  return day.addedCount > 0 || day.readCount > 0;
}

/** 当天「新增 + 阅读」篇数 → 颜色档位 */
export function activityLevel(score: number): 0 | 1 | 2 | 3 | 4 {
  if (score <= 0) return 0;
  if (score === 1) return 1;
  if (score === 2) return 2;
  if (score <= 4) return 3;
  return 4;
}

/**
 * 每日新增 = papers.createdAt 落在当天；
 * 每日阅读 = 当天在阅读台累计 ≥ 5 分钟的不同论文数。
 */
export function buildReadingActivity(input: {
  papers: Paper[];
  readingDays: PaperDayRead[];
  today?: Date;
  weeks?: number;
}): {
  days: DayActivity[];
  checkInDays: number;
  totalReads: number;
  currentStreak: number;
  longestStreak: number;
  rangeLabel: string;
} {
  const today = input.today ?? new Date();
  const weeks = input.weeks ?? 53;
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - (weeks * 7 - 1));
  const startWeekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - startWeekday);
  const startKey = dayKey(start);
  const endKey = dayKey(end);

  const addedByDay = new Map<string, Set<string>>();
  for (const paper of input.papers) {
    if (paper.deletedAt) continue;
    const key = dayKey(paper.createdAt);
    if (!key || key < startKey || key > endKey) continue;
    let set = addedByDay.get(key);
    if (!set) {
      set = new Set();
      addedByDay.set(key, set);
    }
    set.add(paper.id);
  }

  const readByDay = new Map<string, Set<string>>();
  for (const row of input.readingDays) {
    if (row.seconds < READ_SECONDS_THRESHOLD) continue;
    if (!row.day || row.day < startKey || row.day > endKey) continue;
    let set = readByDay.get(row.day);
    if (!set) {
      set = new Set();
      readByDay.set(row.day, set);
    }
    set.add(row.paperId);
  }

  const days: DayActivity[] = [];
  let checkInDays = 0;
  let totalReads = 0;
  const cursor = new Date(start);
  const last = new Date(end);
  const endWeekday = (last.getDay() + 6) % 7;
  last.setDate(last.getDate() + (6 - endWeekday));

  while (cursor <= last) {
    const key = dayKey(cursor);
    const future = cursor > end;
    const addedCount = future ? 0 : (addedByDay.get(key)?.size ?? 0);
    const readCount = future ? 0 : (readByDay.get(key)?.size ?? 0);
    if (addedCount > 0 || readCount > 0) {
      checkInDays += 1;
      totalReads += readCount;
    }
    days.push({
      date: key,
      addedCount,
      readCount,
      level: future ? 0 : activityLevel(addedCount + readCount)
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const { currentStreak, longestStreak } = computeStreaks(days, endKey);
  const rangeLabel = `${startKey.slice(0, 7).replace("-", "/")} – ${endKey.slice(0, 7).replace("-", "/")}`;
  return { days, checkInDays, totalReads, currentStreak, longestStreak, rangeLabel };
}

export function computeStreaks(days: DayActivity[], todayKey: string): { currentStreak: number; longestStreak: number } {
  const past = days.filter(day => day.date <= todayKey);
  let longestStreak = 0;
  let run = 0;
  for (const day of past) {
    if (dayActive(day)) {
      run += 1;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
  }

  let currentStreak = 0;
  for (let index = past.length - 1; index >= 0; index--) {
    const day = past[index];
    if (dayActive(day)) currentStreak += 1;
    else if (day.date === todayKey) continue;
    else break;
  }
  return { currentStreak, longestStreak };
}

export function weeksFromDays(days: DayActivity[]): DayActivity[][] {
  const weeks: DayActivity[][] = [];
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));
  return weeks;
}

export function monthMarkers(weeks: DayActivity[][]): { label: string; weekIndex: number }[] {
  const markers: { label: string; weekIndex: number }[] = [];
  let lastMonth = "";
  weeks.forEach((week, weekIndex) => {
    const first = week[0];
    if (!first) return;
    const month = first.date.slice(5, 7);
    if (month === lastMonth) return;
    lastMonth = month;
    markers.push({ label: `${Number(month)}月`, weekIndex });
  });
  return markers;
}

export function dayTitle(day: DayActivity) {
  return `${day.date} · 新增 ${day.addedCount} 篇 · 阅读 ${day.readCount} 篇`;
}
