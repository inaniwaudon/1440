import clsx from "clsx";
import { formatMinuteOfDay } from "../../utils/time";
import styles from "./TimeLabel.module.css";

type Props = {
  minuteOfDay: number;
  className?: string;
};

export const TimeLabel = ({ minuteOfDay, className }: Props) => {
  const [hh, mm] = formatMinuteOfDay(minuteOfDay).split(":");
  return (
    <span className={clsx(styles.time, className)}>
      {hh}
      <span className={styles.colon}>:</span>
      {mm}
    </span>
  );
};
