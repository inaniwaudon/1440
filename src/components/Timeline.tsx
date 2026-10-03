import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { getMinuteOfDayFromDate, toMinuteOfDay } from "../utils/time";
import { HourDial } from "./HourDial";
import styles from "./Timeline.module.css";


type Props = {
  onSelectMinute: (m: number, cell: HTMLElement) => void;
};

export function Timeline({ onSelectMinute }: Props) {
  const [nowMod, setNowMod] = useState(() => getMinuteOfDayFromDate(new Date()));
  const [activeHour, setActiveHour] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>(Array(24).fill(null));

  useEffect(() => {
    const id = setInterval(() => setNowMod(getMinuteOfDayFromDate(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);

  const thumbBlobs = useLiveQuery(async () => {
    const slots = await db.slots.filter((s) => !!s.photoId).toArray();
    const map = new Map<number, Blob>();
    await Promise.all(
      slots.map(async (slot) => {
        const photo = await db.photos.get(slot.photoId);
        if (photo) map.set(slot.minuteOfDay, photo.thumbnailBlob);
      }),
    );
    return map;
  }, [], new Map<number, Blob>());

  const [thumbUrls, setThumbUrls] = useState(new Map<number, string>());
  useEffect(() => {
    const urls = new Map<number, string>();
    thumbBlobs.forEach((blob, min) => {
      urls.set(min, URL.createObjectURL(blob));
    });
    setThumbUrls(urls);
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [thumbBlobs]);

  const nowHour = Math.floor(nowMod / 60);

  // Which hour block is at the top of the scroll viewport
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onScroll = () => {
      const top = el.getBoundingClientRect().top;
      let found = 0;
      for (let h = 0; h < 24; h++) {
        const b = blockRefs.current[h];
        if (b && b.getBoundingClientRect().top <= top + 4) found = h;
      }
      setActiveHour(found);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToHour = (h: number) => {
    blockRefs.current[h]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className={styles.container}>
      <div className={styles.body}>
        {/* 24 hour blocks, each containing a 5×12 minute grid */}
        <div className={styles.gridScroll} ref={gridRef}>
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              ref={(el) => { blockRefs.current[hour] = el; }}
              className={`${styles.hourBlock} ${hour === nowHour ? styles.hourBlockNow : ""}`}
              onClick={(e) => {
                const cell = (e.target as HTMLElement).closest("[data-minute]") as HTMLElement | null;
                if (
                  cell?.dataset.minute !== undefined &&
                  cell.dataset.hasPhoto === "true"
                ) {
                  onSelectMinute(parseInt(cell.dataset.minute, 10), cell);
                }
              }}
            >
              <span className={styles.hourMarker}>{String(hour).padStart(2, "0")}</span>
              <div className={styles.minuteGrid}>
                {Array.from({ length: 60 }, (_, m) => {
                  const mod = toMinuteOfDay(hour, m);
                  const thumb = thumbUrls.get(mod);
                  return (
                    <div
                      key={m}
                      data-minute={mod}
                      data-has-photo={thumb ? "true" : "false"}
                      className={[
                        styles.cell,
                        thumb ? styles.cellFilled : "",
                        mod === nowMod ? styles.cellNow : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {thumb && <img src={thumb} className={styles.cellThumb} alt="" />}
                      <span className={styles.cellLabel}>
                        {String(m).padStart(2, "0")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

      </div>

      <HourDial
        activeHour={activeHour}
        onScrub={scrollToHour}
      />
    </div>
  );
}
