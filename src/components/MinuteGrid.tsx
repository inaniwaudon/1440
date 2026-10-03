import { MinuteCell } from "./MinuteCell";
import { toMinuteOfDay } from "../utils/time";
import styles from "./MinuteGrid.module.css";

type Props = {
  hour: number;
  nowMinuteOfDay: number;
  onSelectMinute: (minuteOfDay: number) => void;
};

export function MinuteGrid({ hour, nowMinuteOfDay, onSelectMinute }: Props) {
  return (
    <div className={styles.grid}>
      {Array.from({ length: 60 }, (_, i) => (
        <MinuteCell
          key={i}
          minuteOfDay={toMinuteOfDay(hour, i)}
          nowMinuteOfDay={nowMinuteOfDay}
          onSelect={onSelectMinute}
        />
      ))}
    </div>
  );
}
