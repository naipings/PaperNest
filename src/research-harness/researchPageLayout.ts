export type TrajectoryHeightBounds = { min: number; max: number };

/** 按视口高度分档，限制轨迹区可伸缩范围。 */
export function trajectoryHeightBounds(viewportHeight: number): TrajectoryHeightBounds {
  if (viewportHeight >= 1200) return { min: 480, max: 900 };
  if (viewportHeight >= 960) return { min: 460, max: 780 };
  if (viewportHeight >= 760) return { min: 420, max: 640 };
  return { min: 360, max: 520 };
}

/** 内容区最大宽度：跟随页面实际宽度，并随视口分档放宽。 */
export function researchContentMaxWidth(pageWidth: number, viewportWidth: number): number {
  const w = Math.max(pageWidth, viewportWidth);
  if (w >= 1680) return Math.min(1480, pageWidth);
  if (w >= 1360) return Math.min(1360, pageWidth);
  return Math.max(960, pageWidth);
}

export type ResearchLayoutMetrics = {
  contentMaxWidth: number;
  layoutMinHeight: number;
  trajectoryHeight: number;
};

type MeasureResearchLayoutInput = {
  pageWidth: number;
  viewportWidth: number;
  viewportHeight: number;
  headingBottom: number;
  trajectoryBodyTop: number;
  tabsHeight: number;
  hasResumeBar: boolean;
  trajectoryActive: boolean;
};

const PAGE_BOTTOM_PADDING = 50;
const TRAJECTORY_BOTTOM_GAP = 16;
const RESUME_BAR_HEIGHT = 80;

export function measureResearchLayout(input: MeasureResearchLayoutInput): ResearchLayoutMetrics {
  const contentMaxWidth = researchContentMaxWidth(input.pageWidth, input.viewportWidth);
  const layoutMinHeight = Math.max(
    360,
    input.viewportHeight - input.headingBottom - PAGE_BOTTOM_PADDING,
  );

  if (!input.trajectoryActive || input.trajectoryBodyTop <= 0) {
    return { contentMaxWidth, layoutMinHeight, trajectoryHeight: 0 };
  }

  const { min, max } = trajectoryHeightBounds(input.viewportHeight);
  const resume = input.hasResumeBar ? RESUME_BAR_HEIGHT : 0;
  const available =
    input.viewportHeight -
    input.trajectoryBodyTop -
    input.tabsHeight -
    resume -
    PAGE_BOTTOM_PADDING -
    TRAJECTORY_BOTTOM_GAP;
  const trajectoryHeight = Math.round(Math.max(min, Math.min(max, available)));

  return { contentMaxWidth, layoutMinHeight, trajectoryHeight };
}
