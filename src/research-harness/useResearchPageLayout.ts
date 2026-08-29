import { useEffect, type RefObject } from "react";
import { measureResearchLayout } from "./researchPageLayout";

type Options = {
  trajectoryActive: boolean;
  hasResumeBar: boolean;
};

export function useResearchPageLayout(pageRef: RefObject<HTMLElement | null>, options: Options) {
  const { trajectoryActive, hasResumeBar } = options;

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const sync = () => {
      const heading = page.querySelector(".research-page-header-left");
      const trajectoryBody = page.querySelector(".research-main--trajectory .research-detail-body");
      const tabs = trajectoryBody?.querySelector(".research-detail-tabs");

      const metrics = measureResearchLayout({
        pageWidth: page.clientWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        headingBottom: heading?.getBoundingClientRect().bottom ?? 0,
        trajectoryBodyTop: trajectoryBody?.getBoundingClientRect().top ?? 0,
        tabsHeight: tabs?.getBoundingClientRect().height ?? 0,
        hasResumeBar,
        trajectoryActive,
      });

      page.style.setProperty("--research-content-max", `${metrics.contentMaxWidth}px`);
      if (trajectoryActive) {
        page.style.setProperty("--research-layout-min-h", `${metrics.layoutMinHeight}px`);
        page.style.setProperty("--research-trajectory-fit-h", `${metrics.trajectoryHeight}px`);
      } else {
        page.style.removeProperty("--research-layout-min-h");
        page.style.removeProperty("--research-trajectory-fit-h");
      }
    };

    const ro = new ResizeObserver(sync);
    ro.observe(page);
    const main = page.querySelector(".research-main--trajectory");
    if (main) ro.observe(main);
    const heading = page.querySelector(".research-page-header-left");
    if (heading) ro.observe(heading);
    window.addEventListener("resize", sync);
    sync();

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [pageRef, trajectoryActive, hasResumeBar]);
}
