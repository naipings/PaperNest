import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  Radar as RadarIcon,
  RefreshCw,
  Sparkles,
  BookmarkPlus,
  Library,
  Trash2,
} from "lucide-react";
import { backend, isTauri } from "../services/backend";
import { useLibrary } from "../state/LibraryContext";
import { runRadarImportLlmFill } from "../lib/radarImportLlm";
import type { RadarCard, RadarDigest, RadarExplanation, RadarRecommendResult, RadarSettings, RadarWeekHot } from "../types";

type Tab = "hot" | "new" | "interest" | "recommend" | "digest";
type FeedTab = "hot" | "new" | "interest";

const STRATEGY_LABEL: Record<string, string> = {
  personalized_rules: "个性化规则",
  interest_filtered: "兴趣匹配",
  interest_expanded: "兴趣池为空·已放宽",
  embedding_rerank: "语义重排",
  expanded_window: "已放宽时间窗口",
  relaxed_filters: "已放宽过滤",
  board_hot: "热点榜兜底",
  board_new: "新稿榜兜底",
  board_interest: "兴趣召回兜底",
  empty_cta: "暂无数据",
};

const FLASH_MS = 3200;

const isoDate = (value: Date) =>
  value.getFullYear() + "-" + String(value.getMonth() + 1).padStart(2, "0") + "-" + String(value.getDate()).padStart(2, "0");

const RADAR_WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;

function RadarSnapshotCalendar({
  dates,
  selected,
  onSelect,
}: {
  dates: string[];
  selected: string;
  onSelect(date: string): void;
}) {
  const snapshotSet = useMemo(() => new Set(dates), [dates]);
  const anchor = selected || dates[0] || isoDate(new Date());
  const [viewMonth, setViewMonth] = useState(() => {
    const [year, month] = anchor.split("-").map(Number);
    return new Date(year, month - 1, 1);
  });

  useEffect(() => {
    if (!selected) return;
    const [year, month] = selected.split("-").map(Number);
    setViewMonth(current =>
      current.getFullYear() === year && current.getMonth() === month - 1
        ? current
        : new Date(year, month - 1, 1),
    );
  }, [selected]);

  const gridDays = useMemo(() => {
    const start = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
      const value = new Date(start);
      value.setDate(start.getDate() + index);
      return value;
    });
  }, [viewMonth]);

  return (
    <>
      <div className="radar-calendar-head">
        <span className="radar-calendar-month">
          {viewMonth.toLocaleDateString("zh-CN", { year: "numeric", month: "long" })}
        </span>
        <div className="radar-calendar-nav">
          <button
            type="button"
            className="icon-button"
            aria-label="上个月"
            onClick={() => setViewMonth(value => new Date(value.getFullYear(), value.getMonth() - 1, 1))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="下个月"
            onClick={() => setViewMonth(value => new Date(value.getFullYear(), value.getMonth() + 1, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="radar-calendar-weekdays" aria-hidden="true">
        {RADAR_WEEKDAYS.map(day => <span key={day}>{day}</span>)}
      </div>
      <div className="radar-calendar-grid">
        {gridDays.map((day, index) => {
          const dateKey = isoDate(day);
          const hasSnapshot = snapshotSet.has(dateKey);
          const otherMonth = day.getMonth() !== viewMonth.getMonth();
          const classes = [
            "radar-calendar-day",
            otherMonth ? "other-month" : "",
            hasSnapshot ? "has-snapshot" : "",
            dateKey === selected ? "selected" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={`${dateKey}-${index}`}
              type="button"
              className={classes}
              disabled={!hasSnapshot}
              aria-label={dateKey}
              aria-pressed={dateKey === selected}
              onClick={() => onSelect(dateKey)}
            >
              <time dateTime={dateKey}>{day.getDate()}</time>
              {hasSnapshot && <span className="radar-calendar-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <p className="radar-calendar-foot">{dates.length} 天有快照，带圆点的日期可查看</p>
    </>
  );
}

export function RadarView({ onImported }: { onImported?(paperId: string): void }) {
  const {
    refresh, data, radarBusy, radarNotice, setRadarBusy, setRadarNotice,
    radarExplaining, startRadarExplain, finishRadarExplain, radarExplainBusy,
  } = useLibrary();
  const [settings, setSettings] = useState<RadarSettings>();
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [tab, setTab] = useState<Tab>("hot");
  const [cards, setCards] = useState<RadarCard[]>([]);
  const [feedTotal, setFeedTotal] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [week, setWeek] = useState<RadarWeekHot>();
  const [recommend, setRecommend] = useState<RadarRecommendResult>();
  const [digest, setDigest] = useState<RadarDigest | null>();
  const [explain, setExplain] = useState<RadarExplanation>();
  const [explainedIds, setExplainedIds] = useState<Set<string>>(() => new Set());
  const [flash, setFlash] = useState("");
  const [metadataOnly, setMetadataOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);

  const exclusiveBusy = radarBusy;
  const statusBusy = radarBusy || radarExplainBusy;
  const notice = flash || radarNotice;

  const reloadExplainedIds = useCallback(async () => {
    const ids = await backend.radarListExplainedIds();
    setExplainedIds(new Set(ids));
  }, []);

  const flashNotice = useCallback((message: string) => {
    setFlash(message);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(""), FLASH_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const loadDates = useCallback(async () => {
    const list = await backend.radarListDates();
    setDates(list);
    setDate(current => current || list[0] || "");
  }, []);

  const loadFeed = useCallback(async (targetDate: string, feed: FeedTab, all = showAll, hidden = showHidden) => {
    if (!targetDate) {
      setCards([]);
      setFeedTotal(0);
      return;
    }
    const applyFilter = feed === "interest" ? false : (all ? false : true);
    const page = await backend.radarListFeed(targetDate, feed, applyFilter, hidden);
    setCards(page.cards);
    setFeedTotal(page.totalCount);
  }, [showAll, showHidden]);

  useEffect(() => {
    if (!isTauri()) return;
    void backend.radarGetSettings().then(value => {
      setSettings(value);
      setShowAll(!(value.defaultFilterEnabled ?? true));
    }).catch(error => flashNotice(error instanceof Error ? error.message : String(error)));
    void loadDates().catch(error => flashNotice(error instanceof Error ? error.message : String(error)));
    void reloadExplainedIds().catch(error => flashNotice(error instanceof Error ? error.message : String(error)));
  }, [loadDates, flashNotice, reloadExplainedIds]);

  useEffect(() => {
    if (!date || (tab !== "hot" && tab !== "new" && tab !== "interest")) return;
    void loadFeed(date, tab).catch(error => flashNotice(error instanceof Error ? error.message : String(error)));
  }, [date, tab, loadFeed, showAll, showHidden, flashNotice]);

  useEffect(() => {
    if (!date || tab !== "recommend") return;
    void backend.radarRecommend(date, showAll ? false : true).then(setRecommend).catch(error => flashNotice(error instanceof Error ? error.message : String(error)));
  }, [date, tab, showAll, flashNotice]);

  useEffect(() => {
    if (!date || tab !== "digest") return;
    void Promise.all([
      backend.radarWeekHot(date),
      backend.radarGetDigest("daily", date),
    ]).then(([weekHot, daily]) => {
      setWeek(weekHot);
      setDigest(daily);
    }).catch(error => flashNotice(error instanceof Error ? error.message : String(error)));
  }, [date, tab, flashNotice]);

  const fetchToday = async () => {
    if (exclusiveBusy) return;
    setRadarNotice("");
    setFlash("");
    setRadarBusy("正在三路召回：Hot / New / Interest…");
    try {
      const result = await backend.radarFetchToday();
      await loadDates();
      setDate(result.snapshotDate);
      const interest = result.interestCount ?? 0;
      const preferInterest = interest > 0 && (settings?.keywords?.length ?? 0) > 0;
      const nextTab: FeedTab = preferInterest ? "interest" : "hot";
      setTab(nextTab);
      setRadarNotice(
        `完成：热点 ${result.hotCount} · 新稿 ${result.newCount} · 兴趣召回 ${interest}`
        + (result.errors.length ? `（部分失败：${result.errors.join("；")}）` : ""),
      );
      window.setTimeout(() => setRadarNotice(""), 8000);
      await loadFeed(result.snapshotDate, nextTab);
      await reloadExplainedIds();
    } catch (error) {
      setRadarNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setRadarBusy("");
    }
  };

  const importCard = async (card: RadarCard) => {
    if (exclusiveBusy) return;
    const downloadPdf = !metadataOnly;
    setRadarNotice("");
    setFlash("");
    setRadarBusy(downloadPdf
      ? `正在加入资料库：${card.title.slice(0, 40)}…`
      : `正在仅入库元数据：${card.title.slice(0, 40)}…`);
    try {
      const result = await backend.radarImportToLibrary(card.arxivId, downloadPdf);
      let note = result.alreadyInLibrary
        ? (result.downloadedPdf ? "论文已在库中，已补下 PDF。" : "论文已在库中。")
        : (result.downloadedPdf ? "已加入论文库并下载 PDF。" : "已加入论文库（未下载 PDF）。");

      if (!result.alreadyInLibrary && data?.llm.autoAnalyzeOnImport && data.llm.apiKeySaved) {
        setRadarBusy(`正在 LLM 整理：${card.title.slice(0, 36)}…`);
        try {
          const filled = await runRadarImportLlmFill(result.paper, {
            autoClassifyOnImport: data.llm.autoClassifyOnImport ?? true,
            categories: data.categories,
            tags: data.tags,
          });
          note = `${note} ${filled.note}`;
        } catch (error) {
          note = `${note} LLM 整理失败：${error instanceof Error ? error.message : String(error)}`;
        }
      }

      await refresh();
      onImported?.(result.paper.id);
      flashNotice(note);
      if (date && (tab === "hot" || tab === "new" || tab === "interest")) {
        await loadFeed(date, tab);
      }
    } catch (error) {
      flashNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setRadarBusy("");
    }
  };

  const hideCard = async (card: RadarCard) => {
    await backend.radarSetUserState(card.arxivId, undefined, true);
    setCards(current => current.filter(item => item.arxivId !== card.arxivId));
    setRecommend(current => current ? { ...current, items: current.items.filter(item => item.card.arxivId !== card.arxivId) } : current);
    if (explain?.arxivId === card.arxivId) setExplain(undefined);
    flashNotice("已隐藏。可点「显示已隐藏」后恢复。");
  };

  const unhideCard = async (card: RadarCard) => {
    await backend.radarSetUserState(card.arxivId, undefined, false);
    flashNotice("已恢复显示");
    if (date && (tab === "hot" || tab === "new" || tab === "interest")) {
      await loadFeed(date, tab);
    }
  };

  const explainCard = async (card: RadarCard) => {
    setFlash("");
    try {
      const cached = await backend.radarGetExplanation(card.arxivId);
      if (cached) {
        setExplain(cached);
        setExplainedIds(current => {
          if (current.has(card.arxivId)) return current;
          const next = new Set(current);
          next.add(card.arxivId);
          return next;
        });
        return;
      }
    } catch (error) {
      flashNotice(error instanceof Error ? error.message : String(error));
      return;
    }
    if (exclusiveBusy) {
      flashNotice("采集/入库/综述进行中，请稍后再发起新解读。");
      return;
    }
    if (radarExplaining[card.arxivId]) {
      flashNotice("该篇正在解读中…");
      return;
    }
    setRadarNotice("");
    startRadarExplain(card.arxivId, card.title);
    try {
      const result = await backend.radarExplainPaper(card.arxivId);
      setExplain(result);
      setExplainedIds(current => {
        const next = new Set(current);
        next.add(card.arxivId);
        return next;
      });
      setRadarNotice(`解读完成：${card.title.slice(0, 36)}`);
      window.setTimeout(() => setRadarNotice(""), 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRadarNotice(message);
      flashNotice(message);
    } finally {
      finishRadarExplain(card.arxivId);
    }
  };

  const deleteExplanation = async () => {
    if (!explain) return;
    const id = explain.arxivId;
    try {
      await backend.radarDeleteExplanation(id);
      setExplain(undefined);
      setExplainedIds(current => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      flashNotice("已删除解读。");
    } catch (error) {
      flashNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshRadarView = async () => {
    setRefreshing(true);
    setFlash("");
    try {
      await loadDates();
      if (!date) return;
      if (tab === "hot" || tab === "new" || tab === "interest") {
        await loadFeed(date, tab);
      } else if (tab === "recommend") {
        setRecommend(await backend.radarRecommend(date, showAll ? false : true));
      } else if (tab === "digest") {
        const [weekHot, daily] = await Promise.all([
          backend.radarWeekHot(date),
          backend.radarGetDigest("daily", date),
        ]);
        setWeek(weekHot);
        setDigest(daily);
      }
      await reloadExplainedIds();
      flashNotice("界面已刷新");
    } catch (error) {
      flashNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  };

  const hasKeywords = (settings?.keywords?.length ?? 0) > 0;
  const hasInterest = hasKeywords || (settings?.categories?.length ?? 0) > 0;
  const filtering = !showAll && (settings?.defaultFilterEnabled ?? true) && hasInterest && tab !== "interest";

  const renderFilterBar = () => {
    if (tab !== "hot" && tab !== "new" && tab !== "interest" && tab !== "recommend") return null;
    const visible = tab === "recommend" ? (recommend?.items.length ?? 0) : cards.length;
    return (
      <div className="radar-filter-bar">
        <span>
          {showHidden
            ? `已隐藏视图 · ${visible} 篇`
            : filtering
              ? `兴趣过滤 · 显示 ${visible}${tab !== "recommend" && feedTotal > visible ? ` / ${feedTotal}` : ""}`
              : `显示全部 · ${visible} 篇`}
          {hasKeywords && <small>关键词：{settings!.keywords!.join(" · ")}</small>}
        </span>
        <div className="radar-filter-actions">
          {(tab === "hot" || tab === "new" || tab === "interest") && (
            <button type="button" className="secondary" onClick={() => setShowHidden(current => !current)}>
              {showHidden ? "退出已隐藏" : "显示已隐藏"}
            </button>
          )}
          {hasInterest && tab !== "interest" && (
            <button type="button" className="secondary" onClick={() => setShowAll(current => !current)}>
              {showAll ? "启用兴趣过滤" : "显示全部"}
            </button>
          )}
        </div>
      </div>
    );
  };

  const openUrl = async (url?: string) => {
    if (!url) return;
    try { await backend.openExternalUrl(url); }
    catch (error) { flashNotice(error instanceof Error ? error.message : String(error)); }
  };

  const renderCard = (card: RadarCard, reasons?: string[]) => (
    <article key={`${card.feed}-${card.arxivId}`} className={`radar-card${card.inLibrary ? " in-library" : ""}${card.hidden ? " is-hidden" : ""}`}>
      <header>
        <strong>{card.title}</strong>
        <div className="radar-card-meta">
          {card.rank != null && <span>#{card.rank}</span>}
          {card.upvotes != null && <span>▲{card.upvotes}</span>}
          {card.primaryCategory && <span>{card.primaryCategory}</span>}
          {card.inLibrary && <span className="radar-badge">已在库</span>}
          {card.hidden && <span className="radar-badge">已隐藏</span>}
        </div>
      </header>
      <p>{card.aiSummary || card.abstractText || "暂无摘要"}</p>
      {reasons && reasons.length > 0 && <div className="radar-reasons">{reasons.map(reason => <span key={reason}>{reason}</span>)}</div>}
      <footer>
        <button type="button" className="secondary" onClick={() => void openUrl(card.absUrl || card.alphaxivUrl)}><ExternalLink size={14} />原文</button>
        <button type="button" className="secondary" onClick={() => void backend.radarSetUserState(card.arxivId, true).then(() => flashNotice("已标记稍后阅读"))}><BookmarkPlus size={14} />稍后</button>
        {card.hidden ? (
          <button type="button" className="secondary" onClick={() => void unhideCard(card)}><Eye size={14} />恢复</button>
        ) : (
          <button type="button" className="secondary" onClick={() => void hideCard(card)}><EyeOff size={14} />隐藏</button>
        )}
        <button
          type="button"
          className={`secondary${explainedIds.has(card.arxivId) ? " radar-btn-explained" : ""}${radarExplaining[card.arxivId] ? " radar-btn-explaining" : ""}`}
          disabled={!!radarExplaining[card.arxivId]}
          onClick={() => void explainCard(card)}
          title={explainedIds.has(card.arxivId) ? "已有本地解读，点击查看" : radarExplaining[card.arxivId] ? "正在解读…" : "调用 LLM 解读"}
        >
          {radarExplaining[card.arxivId] ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
          {explainedIds.has(card.arxivId) ? "已解读" : "解读"}
        </button>
        <button type="button" className="primary" disabled={!!exclusiveBusy} onClick={() => void importCard(card)}>
          <Library size={14} />{metadataOnly ? "仅元数据入库" : "加入论文库"}
        </button>
      </footer>
    </article>
  );

  if (!isTauri()) {
    return <main className="content-page radar-page"><header className="page-heading"><div className="page-title-block"><div className="page-title-row"><span className="page-title-icon"><RadarIcon size={18} /></span><h1>论文雷达</h1></div><p>浏览器预览模式不支持联网雷达，请使用桌面端。</p></div></header></main>;
  }

  if (!settings) {
    return <main className="content-page radar-page"><header className="page-heading"><div className="page-title-block"><div className="page-title-row"><span className="page-title-icon"><RadarIcon size={18} /></span><h1>论文雷达</h1></div><p className="inline-notice"><LoaderCircle className="spin" size={14} />正在加载设置…</p></div></header></main>;
  }

  if (!settings.enabled) {
    return <main className="content-page radar-page"><header className="page-heading"><div className="page-title-block"><div className="page-title-row"><span className="page-title-icon"><RadarIcon size={18} /></span><h1>论文雷达</h1><span className="page-kicker">发现层</span></div><p>请到「设置 → 论文雷达」启用后，点击「推荐今日论文」开始采集。</p></div></header></main>;
  }

  return (
    <main className="content-page radar-page">
      <header className="page-heading">
        <div className="page-title-block">
          <div className="page-title-row"><span className="page-title-icon"><RadarIcon size={18} /></span><h1>论文雷达</h1><span className="page-kicker">发现层</span></div>
    <p>三路召回：alphaxiv 热点 / arXiv 新稿 / 关键词兴趣。加入论文库时下载 PDF。本页默认只读本地快照，点击「推荐今日论文」才联网采集。</p>
        </div>
        <div className="page-heading-actions">
          <button type="button" className="ghost" disabled={refreshing || !!exclusiveBusy} onClick={() => void refreshRadarView()} title="重新加载当前榜单（本地快照）">
            <RefreshCw size={15} className={refreshing ? "spin" : undefined} />刷新
          </button>
          <button type="button" className="primary" disabled={!!exclusiveBusy} onClick={() => void fetchToday()}>
            {exclusiveBusy && radarBusy.startsWith("正在三路") ? <LoaderCircle className="spin" size={16} /> : <RadarIcon size={16} />}
            推荐今日论文
          </button>
          <label className="checkbox-setting radar-import-option">
            <input type="checkbox" checked={metadataOnly} onChange={event => setMetadataOnly(event.target.checked)} />
            加入时只入库元数据
          </label>
          <div className="stat-card"><strong>{dates.length}</strong><small>采集日</small></div>
        </div>
      </header>

      <div className="radar-layout">
        <aside className="radar-calendar">
          <h3><CalendarDays size={15} />日历</h3>
          {dates.length === 0 && <p className="radar-empty">尚无采集记录。点击右上角「推荐今日论文」开始。</p>}
          {dates.length > 0 && (
            <RadarSnapshotCalendar dates={dates} selected={date} onSelect={setDate} />
          )}
        </aside>

        <section className="radar-main">
          <nav className="radar-tabs">
            <div className="radar-tabs-list">
              {([
                ["hot", "alphaxiv 热点榜"],
                ["new", "arXiv 新稿榜"],
                ["interest", "兴趣召回"],
                ["recommend", "为你推荐"],
                ["digest", "趋势综述"],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
            <div className="radar-tabs-status">
              {statusBusy && <div className="radar-toast radar-toast-busy" role="status"><LoaderCircle className="spin" size={14} />{statusBusy}</div>}
              {notice && !statusBusy && <div className="radar-toast" role="status">{notice}</div>}
            </div>
          </nav>

          {renderFilterBar()}
          {tab === "interest" && (
            <p className="radar-strategy">
              {hasKeywords
                ? `关键词查询召回 · ${cards.length} 篇（近 3 日窗 · 订阅类目内）`
                : "未配置兴趣关键词。请到「设置 → 论文雷达」添加后，再点「推荐今日论文」。"}
            </p>
          )}

          {(tab === "hot" || tab === "new" || tab === "interest") && (
            <div className="radar-card-list">
              {!date && <p className="radar-empty">选择日期或先推荐今日论文。</p>}
              {date && tab === "interest" && !hasKeywords && (
                <p className="radar-empty">配置关键词后才会走 Interest 召回路。</p>
              )}
              {date && cards.length === 0 && showHidden && (
                <p className="radar-empty">当前没有已隐藏论文。</p>
              )}
              {date && cards.length === 0 && filtering && feedTotal > 0 && !showHidden && (
                <p className="radar-empty">兴趣过滤后暂无匹配。可点击「显示全部」，或到设置添加/调整关键词。</p>
              )}
              {date && cards.length === 0 && !(filtering && feedTotal > 0) && !(tab === "interest" && !hasKeywords) && !showHidden && (
                <p className="radar-empty">该日暂无{tab === "hot" ? "alphaxiv 热点" : tab === "new" ? "arXiv 新稿" : "兴趣召回"}数据。</p>
              )}
              {cards.map(card => renderCard(card))}
            </div>
          )}

          {tab === "recommend" && (
            <div className="radar-card-list">
              {recommend && (
                <p className="radar-strategy">
                  策略：{STRATEGY_LABEL[recommend.strategy] || recommend.strategy}
                  · 窗口 {recommend.windowDays} 天
                  · 覆盖 {recommend.coverageDays} 个采集日
                </p>
              )}
              {recommend?.strategy === "empty_cta" && <p className="radar-empty">候选池为空。请先点击「推荐今日论文」。</p>}
              {recommend?.items.map(item => renderCard(item.card, item.reasons))}
            </div>
          )}

          {tab === "digest" && (
            <div className="radar-digest">
              {week && (
                <section className="radar-week-panel">
                  <h3>近 7 日热点（覆盖 {week.coverageDays} 个采集日：{week.windowStart} ~ {week.windowEnd}）</h3>
                  <div className="radar-week-grid">
                    <div>
                      <h4>方向分布</h4>
                      <ul>{week.categories.map(item => <li key={item.category}>{item.category} · {item.paperCount} 篇 · ▲{item.maxUpvotes}</li>)}</ul>
                    </div>
                    <div>
                      <h4>持续上榜</h4>
                      <ul>{week.persistent.map(item => <li key={item.arxivId}>{item.title} · {item.days} 天 · ▲{item.peakUpvotes}</li>)}</ul>
                    </div>
                  </div>
                </section>
              )}
              <div className="radar-digest-actions">
                <button type="button" className="secondary" disabled={!!exclusiveBusy || !date} onClick={() => {
                  if (exclusiveBusy) return;
                  setRadarBusy("正在生成日综述…");
                  void backend.radarGenerateDigest("daily", date)
                    .then(setDigest)
                    .catch(error => flashNotice(error instanceof Error ? error.message : String(error)))
                    .finally(() => setRadarBusy(""));
                }}>生成今日综述</button>
                <button type="button" className="secondary" disabled={!!exclusiveBusy || !date} onClick={() => {
                  if (exclusiveBusy) return;
                  setRadarBusy("正在生成近 7 日趋势…");
                  void backend.radarGenerateDigest("weekly", date)
                    .then(setDigest)
                    .catch(error => flashNotice(error instanceof Error ? error.message : String(error)))
                    .finally(() => setRadarBusy(""));
                }}>生成近 7 日趋势</button>
              </div>
              {digest && (
                <article className="radar-digest-body">
                  <h3>{digest.kind === "weekly" ? "窗口趋势" : "日综述"} · 覆盖 {digest.coverageDays} 日 · {digest.paperCount} 篇</h3>
                  <p>{digest.overview}</p>
                  {digest.clusters.map(cluster => (
                    <div key={cluster.theme} className="radar-cluster">
                      <strong>{cluster.theme}</strong>
                      <p>{cluster.summary}</p>
                      <ul>{cluster.papers.map(paper => <li key={paper.id}>{paper.title}</li>)}</ul>
                    </div>
                  ))}
                </article>
              )}
            </div>
          )}
        </section>

        {explain && (
          <aside className="radar-explain">
            <header>
              <h3>单篇解读</h3>
              <div className="radar-explain-actions">
                <button type="button" className="ghost danger" onClick={() => void deleteExplanation()} title="删除解读">
                  <Trash2 size={14} />删除
                </button>
                <button type="button" className="ghost" onClick={() => setExplain(undefined)}>关闭</button>
              </div>
            </header>
            {(explain.titleZh || explain.titleEn) && (
              <p>
                <strong>标题</strong>
                {explain.titleZh && <span>{explain.titleZh}</span>}
                {explain.titleEn && <small className="radar-explain-en">{explain.titleEn}</small>}
              </p>
            )}
            {explain.summaryZh && <p><strong>一句话</strong>{explain.summaryZh}</p>}
            {explain.abstractZh && <p><strong>中文摘要</strong>{explain.abstractZh}</p>}
            <p><strong>问题</strong>{explain.problem}</p>
            <div className="radar-explain-method">
              <strong>方法</strong>
              {explain.method
                .split(/\n{2,}/)
                .map(part => part.trim())
                .filter(Boolean)
                .map((para, index) => <p key={index}>{para}</p>)}
            </div>
            <p><strong>结论</strong>{explain.finding}</p>
            <p><strong>亮点</strong>{explain.highlight}</p>
          </aside>
        )}
      </div>
    </main>
  );
}
