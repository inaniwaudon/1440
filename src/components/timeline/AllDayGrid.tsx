import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/db";
import styles from "./AllDayGrid.module.css";

type Props = {
  nowMinuteOfDay: number;
  selectedHour: number | null;
  onSelectHour: (hour: number) => void;
};

export function AllDayGrid({
  nowMinuteOfDay,
  selectedHour,
  onSelectHour,
}: Props) {
  // Single query for all filled slots — far cheaper than per-cell queries
  const filledSet = useLiveQuery(
    () =>
      db.slots
        .filter((s) => !!s.photoId)
        .toArray()
        .then((rows) => new Set(rows.map((r) => r.minuteOfDay))),
    [],
    new Set<number>(),
  );

  const nowHour = Math.floor(nowMinuteOfDay / 60);

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const hour = Math.min(23, Math.max(0, Math.floor((y / rect.height) * 24)));
    onSelectHour(hour);
  };

  return (
    <div className={styles.grid} onPointerUp={handlePointerUp}>
      {Array.from({ length: 1440 }, (_, i) => {
        const hour = Math.floor(i / 60);
        const filled = filledSet.has(i);
        const isNow = i === nowMinuteOfDay;
        const isNowHour = hour === nowHour;
        const isSelected = selectedHour === hour;

        let cls = styles.cell;
        if (isNow) cls += ` ${styles.nowCell}`;
        else if (filled && isSelected) cls += ` ${styles.filledSelected}`;
        else if (filled) cls += ` ${styles.filled}`;
        else if (isSelected) cls += ` ${styles.selected}`;
        else if (isNowHour) cls += ` ${styles.nowHourCell}`;

        // biome-ignore lint/suspicious/noArrayIndexKey: static 1440-length list, order fixed
        return <div key={i} className={cls} />;
      })}
    </div>
  );
}
