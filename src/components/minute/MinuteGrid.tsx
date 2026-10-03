import { toMinuteOfDay } from "../../utils/time";
import { MinuteCell } from "./MinuteCell";
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
          // biome-ignore lint/suspicious/noArrayIndexKey: static 60-length list, order fixed
          key={i}
          minuteOfDay={toMinuteOfDay(hour, i)}
          nowMinuteOfDay={nowMinuteOfDay}
          onSelect={onSelectMinute}
        />
      ))}
    </div>
  );
}
