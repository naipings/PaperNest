type Props = {
  percent: number;
  nearCompaction: boolean;
  title: string;
  onClick: () => void;
};

const R = 8;
const C = 2 * Math.PI * R;

export function ResearchContextRing({ percent, nearCompaction, title, onClick }: Props) {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = (clamped / 100) * C;

  return (
    <button
      type="button"
      className={`research-context-ring${nearCompaction ? " is-warn" : ""}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden>
        <circle className="research-context-ring-track" cx="10" cy="10" r={R} />
        <circle
          className="research-context-ring-fill"
          cx="10"
          cy="10"
          r={R}
          strokeDasharray={`${filled} ${C}`}
          transform="rotate(-90 10 10)"
        />
      </svg>
    </button>
  );
}
