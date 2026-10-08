import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "../../db/db";
import type { PhotoRecord, SlotRecord } from "../../db/types";
import {
  getMinuteOfDayFromDate,
  NUMBER_POSITION_STORAGE_KEY,
  type NumberPosition,
  readStoredNumberPosition,
} from "../../utils/time";
import { FaceBlurImage } from "../media/FaceBlurImage";
import { TimeLabel } from "../time/TimeLabel";
import styles from "./LandscapeSlideshow.module.css";

type Props = {
  enabled: boolean;
  blurImages: boolean;
};

/**
 * 現在時刻（分）以下で最大のスロットを返す。該当しない場合は、全体の最後のスロットを返す。
 */
const pickSlot = (
  slots: SlotRecord[],
  nowMinute: number,
): SlotRecord | null => {
  if (slots.length === 0) {
    return null;
  }
  let candidate: SlotRecord | null = null;
  for (const slot of slots) {
    if (slot.minuteOfDay <= nowMinute) {
      candidate = slot;
    } else {
      break;
    }
  }
  return candidate ?? slots[slots.length - 1];
};

export const LandscapeSlideshow = ({ enabled, blurImages }: Props) => {
  const [isLandscape, setIsLandscape] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [nowMinute, setNowMinute] = useState(() =>
    getMinuteOfDayFromDate(new Date()),
  );
  const [numberPosition, setNumberPosition] = useState<NumberPosition>(
    readStoredNumberPosition,
  );

  useEffect(() => {
    const mql = window.matchMedia("(orientation: landscape)");
    const update = () => {
      setIsLandscape(mql.matches);
    };
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  // 縦向きに戻ったら、再度横向きになった際にスライドショーを再開できるよう dismiss をリセットする
  useEffect(() => {
    if (!isLandscape) {
      setDismissed(false);
    }
  }, [isLandscape]);

  const active = enabled && isLandscape && !dismissed;

  // アクティブになった際に、最新の設定を localStorage から読み直す
  useEffect(() => {
    if (active) {
      setNumberPosition(readStoredNumberPosition());
    }
  }, [active]);

  // 他タブでの変更にも追従する
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === NUMBER_POSITION_STORAGE_KEY) {
        setNumberPosition(readStoredNumberPosition());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    const tick = () => setNowMinute(getMinuteOfDayFromDate(new Date()));
    tick();
    const interval = window.setInterval(tick, 15000);
    return () => window.clearInterval(interval);
  }, [active]);

  const slots = useLiveQuery<SlotRecord[], SlotRecord[]>(
    () => db.slots.orderBy("minuteOfDay").toArray(),
    [],
    [],
  );

  const targetSlot = pickSlot(slots, nowMinute);
  const photo = useLiveQuery<PhotoRecord | undefined, undefined>(
    async () => {
      if (!targetSlot) {
        return undefined;
      }
      return await db.photos.get(targetSlot.photoId);
    },
    [targetSlot?.photoId],
    undefined,
  );

  const isVideo =
    !!photo && photo.mimeType?.startsWith("video/") && !!photo.videoBlob;
  const mediaBlob = photo
    ? isVideo
      ? photo.videoBlob
      : (photo.previewBlob ?? photo.thumbnailBlob)
    : null;

  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!mediaBlob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(mediaBlob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [mediaBlob]);

  if (!active || !photo || !url) {
    return null;
  }

  const shouldBlur =
    blurImages && (photo.blurOverride ?? photo.hasDetectedFace === true);

  return (
    <button
      type="button"
      className={styles.overlay}
      onClick={() => setDismissed(true)}
      aria-label="Close slideshow"
    >
      {isVideo ? (
        <video
          key={photo.id}
          src={url}
          className={`${styles.media} ${shouldBlur ? styles.blurred : ""}`}
          autoPlay
          loop
          muted
          playsInline
        />
      ) : (
        <FaceBlurImage
          src={url}
          alt=""
          className={styles.media}
          fallbackBlurClassName={styles.blurred}
          enabled={blurImages}
          photo={photo}
        />
      )}
      <TimeLabel
        minuteOfDay={photo.minuteOfDay}
        className={clsx(
          styles.time,
          numberPosition === "middle" ? styles.timeMiddle : styles.timeCorner,
        )}
      />
    </button>
  );
};
