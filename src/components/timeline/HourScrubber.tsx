import { useRef } from "react";
import styles from "./HourScrubber.module.css";

type Props = {
  selectedHour: number | null;
  nowHour: number;
  onChange: (hour: number) => void;
};

export function HourScrubber({ selectedHour, nowHour, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const hourFromClientY = (clientY: number): number => {
    const rect = ref.current?.getBoundingClientRect();
    const y = Math.max(0, Math.min(clientY - rect.top, rect.height - 1));
    return Math.floor((y / rect.height) * 24);
  };

  return (
    <div
      ref={ref}
      className={styles.strip}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onChange(hourFromClientY(e.clientY));
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0) return;
        onChange(hourFromClientY(e.clientY));
      }}
    >
      {Array.from({ length: 24 }, (_, h) => {
        const showLabel = h % 6 === 0 || h === 23;
        const isSelected = h === selectedHour;
        const isNow = h === nowHour;

        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static 24-length list, order fixed
            key={h}
            className={[
              styles.tick,
              isSelected ? styles.tickSelected : "",
              isNow ? styles.tickNow : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {showLabel && (
              <span className={styles.label}>{String(h).padStart(2, "0")}</span>
            )}
            {isSelected && !showLabel && (
              <span className={styles.label}>{String(h).padStart(2, "0")}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
