import { useRef, useState } from "react";
import styles from "./HourDial.module.css";

type Props = {
  activeHour: number;
  onScrub: (hour: number) => void;
};

const DIAL_SIZE = 420; // px
const ARC_HALF_DEG = 60; // ±60° around the "9 o'clock" (left) direction
// 24 hours fan out across the 2*ARC_HALF_DEG arc. Edges inclusive: h=0 at -ARC_HALF_DEG, h=23 at +ARC_HALF_DEG.
const DEG_PER_HOUR = (2 * ARC_HALF_DEG) / 23;

// Convert an offset from the left/9 o'clock axis (negative = above, positive = below)
// into a CSS/math angle measured from the +x axis (y-down), where 180° = left.
// y-down convention: angles 180°→270° span lower-left (positive sin → below),
// while 90°→180° span upper-left. So negative offset (above) → mathAngle > 180.
function offsetToMathAngle(offsetDeg: number): number {
  return 180 - offsetDeg;
}

export function HourDial({ activeHour, onScrub }: Props) {
  const [open, setOpen] = useState(false);
  const [displayHour, setDisplayHour] = useState(activeHour);
  const dialRef = useRef<HTMLDivElement>(null);

  // Keep displayHour in sync with external activeHour when idle
  if (!open && displayHour !== activeHour) {
    setDisplayHour(activeHour);
  }

  const hourFromPointer = (clientX: number, clientY: number): number => {
    const el = dialRef.current;
    if (!el) return displayHour;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    // Math angle from +x axis (y-down), 180° = left
    const mathAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Offset from the left axis. Negative = above, positive = below.
    let offset = 180 - mathAngle;
    while (offset > 180) offset -= 360;
    while (offset < -180) offset += 360;
    const clamped = Math.max(-ARC_HALF_DEG, Math.min(ARC_HALF_DEG, offset));
    // offset -60° (upper-left) → hour 0; +60° (lower-left) → hour 23
    const hour = Math.round((clamped + ARC_HALF_DEG) / DEG_PER_HOUR);
    return Math.max(0, Math.min(23, hour));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setOpen(true);
    setDisplayHour(activeHour);
    // Note: don't scrub on down — the dot sits off-axis and would snap the hour
    // to whatever happens to be at the dot's angle. Wait for actual movement.
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!open) return;
    const hour = hourFromPointer(e.clientX, e.clientY);
    if (hour !== displayHour) {
      setDisplayHour(hour);
      onScrub(hour);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setOpen(false);
  };

  const radius = DIAL_SIZE / 2;
  const labelRadius = radius - 18;

  return (
    <div
      className={styles.root}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {!open ? (
        <div
          className={styles.dot}
          aria-label={`${String(activeHour).padStart(2, "0")}:00`}
        >
          <span className={styles.clockNumber}>
            {String(activeHour).padStart(2, "0")}
          </span>
          <span
            className={styles.hourHand}
            style={{ transform: `translateX(-50%) rotate(${(activeHour % 12) * 30}deg)` }}
          />
          <span className={styles.minuteHand} />
          <span className={styles.clockPin} />
        </div>
      ) : (
        <div
          className={styles.dialWrap}
          style={{ ["--dial-size" as string]: `${DIAL_SIZE}px` }}
        >
          <div className={styles.dial} ref={dialRef}>
            {Array.from({ length: 24 }, (_, h) => {
              const offset = -ARC_HALF_DEG + h * DEG_PER_HOUR; // -60 .. +60
              const mathAngle = offsetToMathAngle(offset);
              const rad = (mathAngle * Math.PI) / 180;
              const x = Math.cos(rad) * labelRadius;
              const y = Math.sin(rad) * labelRadius;
              const isMajor = h % 3 === 0;
              const isSelected = h === displayHour;
              return (
                <div
                  key={h}
                  className={`${styles.tick} ${isSelected ? styles.tickActive : ""}`}
                  style={{ transform: `translate(${x}px, ${y}px)` }}
                >
                  <span
                    className={[
                      styles.tickInner,
                      isMajor ? styles.tickMajor : "",
                      isSelected ? styles.tickSelected : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {String(h).padStart(2, "0")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
