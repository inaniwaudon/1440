import { useRef } from "react";
import { MinuteCell } from "./MinuteCell";
import { toMinuteOfDay } from "../utils/time";
import styles from "./HourDetail.module.css";

type Props = {
  hour: number | null;
  nowMinuteOfDay: number;
  onClose: () => void;
  onSelectMinute: (minuteOfDay: number) => void;
};

export function HourDetail({ hour, nowMinuteOfDay, onClose, onSelectMinute }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  if (hour === null) return null;

  return (
    <div
      className={styles.overlay}
      ref={overlayRef}
      onPointerDown={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className={styles.sheet}>
        <div className={styles.handle} />
        <div className={styles.titleBar}>
          <span className={styles.title}>{String(hour).padStart(2, "0")}:00</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.grid}>
          {Array.from({ length: 60 }, (_, m) => (
            <MinuteCell
              key={m}
              minuteOfDay={toMinuteOfDay(hour, m)}
              nowMinuteOfDay={nowMinuteOfDay}
              onSelect={(mod) => {
                onSelectMinute(mod);
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
