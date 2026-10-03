import { useLiveQuery } from "dexie-react-hooks";
import { useRef } from "react";
import { db } from "../../db/db";
import { toMinuteOfDay } from "../../utils/time";
import { MinuteGrid } from "../minute/MinuteGrid";
import styles from "./HourRow.module.css";

type Props = {
  hour: number;
  isExpanded: boolean;
  nowMinuteOfDay: number;
  onExpand: (hour: number) => void;
  onSelectMinute: (minuteOfDay: number) => void;
};

export function HourRow({
  hour,
  isExpanded,
  nowMinuteOfDay,
  onExpand,
  onSelectMinute,
}: Props) {
  const nowHour = Math.floor(nowMinuteOfDay / 60);
  const isNowHour = hour === nowHour;
  const gridRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const filledCount = useLiveQuery(
    () =>
      db.slots
        .where("minuteOfDay")
        .between(toMinuteOfDay(hour, 0), toMinuteOfDay(hour, 59), true, true)
        .filter((s) => !!s.photoId)
        .count(),
    [hour],
    0,
  );

  // Resolve which minute cell is under a pointer position
  const minuteFromPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cell = el.closest("[data-minute]") as HTMLElement | null;
    if (!cell) return null;
    const m = parseInt(cell.dataset.minute ?? "", 10);
    return Number.isNaN(m) ? null : m;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    isDraggingRef.current = false;
    onExpand(hour);
  };

  // While dragging over an expanded grid, highlight the hovered cell
  const handleGridPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pressure === 0) return;
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    minuteFromPoint(e.clientX, e.clientY); // just track; highlight via CSS :hover
  };

  const handleGridPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const m = minuteFromPoint(e.clientX, e.clientY);
    if (m !== null) onSelectMinute(m);
    isDraggingRef.current = false;
  };

  return (
    <div className={`${styles.row} ${isNowHour ? styles.nowHour : ""}`}>
      <div
        className={styles.header}
        onPointerDown={handlePointerDown}
        style={{ touchAction: "manipulation" }}
      >
        <span
          className={`${styles.hourLabel} ${isNowHour ? styles.nowHourLabel : ""}`}
        >
          {String(hour).padStart(2, "0")}
        </span>
        <span className={styles.fillInfo}>
          {filledCount > 0 ? `${filledCount}/60` : ""}
        </span>
        <span
          className={`${styles.arrow} ${isExpanded ? styles.arrowExpanded : ""}`}
        >
          ▼
        </span>
      </div>

      <div
        className={`${styles.expandPanel} ${isExpanded ? styles.expanded : ""}`}
      >
        <div className={styles.expandInner}>
          {isExpanded && (
            <div
              ref={gridRef}
              style={{ touchAction: "none" }}
              onPointerMove={handleGridPointerMove}
              onPointerUp={handleGridPointerUp}
            >
              <MinuteGrid
                hour={hour}
                nowMinuteOfDay={nowMinuteOfDay}
                onSelectMinute={onSelectMinute}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
