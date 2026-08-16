import { useMemo, useState } from "react";
import { buildReadingActivity, dayTitle, monthMarkers, weeksFromDays, type DayActivity } from "../lib/readingActivity";
import { useLibrary } from "../state/LibraryContext";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function ReadingHeatmap() {
  const { data } = useLibrary();
  const [hover, setHover] = useState<DayActivity>();
  const activity = useMemo(() => {
    if (!data) return null;
    return buildReadingActivity({
      papers: data.papers,
      readingDays: data.readingDays ?? [],
      weeks: 53
    });
  }, [data]);
  if (!data || !activity) return null;
  const weeks = weeksFromDays(activity.days);
  const months = monthMarkers(weeks);
  return <section className="reading-heatmap" aria-label="阅读打卡">
    <div className="reading-heatmap-board">
      <header>
        <h2>阅读打卡</h2>
        <div className="reading-heatmap-legend" aria-hidden="true">
          <span>少</span>
          {[0, 1, 2, 3, 4].map(level => <i key={level} className={`reading-heat-dot level-${level}`} />)}
          <span>多</span>
        </div>
      </header>
      <div className="reading-heatmap-grid-wrap">
        <div className="reading-heatmap-weekdays">
          {WEEKDAY_LABELS.map((label, index) => <span key={label}>{index === 0 || index === 2 || index === 4 ? label : ""}</span>)}
        </div>
        <div className="reading-heatmap-scroll">
          <div className="reading-heatmap-months" style={{ gridTemplateColumns: `repeat(${weeks.length}, 12px)` }}>
            {months.map(marker => <span key={`${marker.label}-${marker.weekIndex}`} style={{ gridColumn: marker.weekIndex + 1 }}>{marker.label}</span>)}
          </div>
          <div className="reading-heatmap-grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, 12px)` }}>
            {weeks.map((week, weekIndex) => week.map((day, dayIndex) => (
              <button
                key={day.date}
                type="button"
                className={`reading-heat-dot level-${day.level}`}
                style={{ gridColumn: weekIndex + 1, gridRow: dayIndex + 1 }}
                title={dayTitle(day)}
                aria-label={dayTitle(day)}
                onMouseEnter={() => setHover(day)}
                onMouseLeave={() => setHover(undefined)}
              />
            )))}
          </div>
        </div>
      </div>
      <footer className="reading-heatmap-footer">
        <p className="reading-heatmap-hint">
          {hover
            ? dayTitle(hover)
            : `近一年 · ${activity.checkInDays} 天有新增或阅读 · ${activity.rangeLabel}（阅读需单日满 5 分钟）`}
        </p>
        <div className="reading-heatmap-stats" aria-label="打卡统计">
          <article><strong>{activity.checkInDays}</strong><span>打卡天数</span></article>
          <article><strong>{activity.currentStreak}</strong><span>当前连续</span></article>
          <article><strong>{activity.longestStreak}</strong><span>最长连续</span></article>
          <article><strong>{activity.totalReads}</strong><span>累计阅读</span></article>
        </div>
      </footer>
    </div>
  </section>;
}
