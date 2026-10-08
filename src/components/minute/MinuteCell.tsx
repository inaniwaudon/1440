import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "../../db/db";
import { fromMinuteOfDay } from "../../utils/time";
import styles from "./MinuteCell.module.css";

type Props = {
  minuteOfDay: number;
  nowMinuteOfDay: number;
  onSelect: (minuteOfDay: number) => void;
};

export const MinuteCell = ({
  minuteOfDay,
  nowMinuteOfDay,
  onSelect,
}: Props) => {
  const { minute } = fromMinuteOfDay(minuteOfDay);
  const isNow = minuteOfDay === nowMinuteOfDay;

  const slot = useLiveQuery(() => db.slots.get(minuteOfDay), [minuteOfDay]);
  const photo = useLiveQuery(
    () => (slot?.photoId ? db.photos.get(slot.photoId) : undefined),
    [slot?.photoId],
  );

  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photo?.thumbnailBlob) {
      setThumbUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo.thumbnailBlob);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo?.thumbnailBlob]);

  const filled = !!slot?.photoId;
  return (
    <button
      type="button"
      className={clsx(
        styles.cell,
        filled && styles.filled,
        isNow && styles.now,
      )}
      data-minute={minuteOfDay}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(minuteOfDay);
      }}
      style={thumbUrl ? { backgroundImage: `url(${thumbUrl})` } : undefined}
    >
      {isNow && <span className={styles.nowLabel}>NOW</span>}
      <span className={styles.minuteLabel}>
        {String(minute).padStart(2, "0")}
      </span>
    </button>
  );
};
