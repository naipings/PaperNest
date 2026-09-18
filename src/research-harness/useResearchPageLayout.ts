import { useEffect, type RefObject } from "react";
import { measureResearchLayout } from "./researchPageLayout";

type Options = {
  trajectoryActive: boolean;
  reportActive: boolean;
  hasResumeBar: boolean;
};

/** 页眉/会话头估算：避免用会随轨迹高度回变的 DOM top 形成反馈环。 */
const DETAIL_CHROME_BELOW_HEADING = 120;
const TABS_HEIGHT = 52;

export function useResearchPageLayout(pageRef: RefObject<HTMLElement | null>, options: Options) {
  const { trajectoryActive, reportActive, hasResumeBar } = options;
  const expandedActive = trajectoryActive || reportActive;

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const sync = () => {
      const heading = page.querySelector(".research-page-header-left");
      const headingBottom = heading?.getBoundingClientRect().bottom ?? 0;
      // 轨迹壳高度只依赖视口与页眉，不观察轨迹区自身，避免点选事件导致框体忽大忽小。
      const metrics = measureResearchLayout({
        pageWidth: page.clientWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        headingBottom,
        trajectoryBodyTop: headingBottom + DETAIL_CHROME_BELOW_HEADING,
        tabsHeight: TABS_HEIGHT,
        hasResumeBar,
        trajectoryActive,
      });

      page.style.setProperty("--research-content-max", `${metrics.contentMaxWidth}px`);
      if (expandedActive) {
        page.style.setProperty("--research-layout-min-h", `${metrics.layoutMinHeight}px`);
      } else {
        page.style.removeProperty("--research-layout-min-h");
      }
      if (trajectoryActive) {
        page.style.setProperty("--research-trajectory-fit-h", `${metrics.trajectoryHeight}px`);
      } else {
        page.style.removeProperty("--research-trajectory-fit-h");
      }
    };

    const ro = new ResizeObserver(() => sync());
    ro.observe(page);
    const heading = page.querySelector(".research-page-header-left");
    if (heading) ro.observe(heading);
    window.addEventListener("resize", sync);
    sync();

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [pageRef, trajectoryActive, reportActive, expandedActive, hasResumeBar]);
}
