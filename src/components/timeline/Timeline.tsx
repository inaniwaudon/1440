import { useLiveQuery } from "dexie-react-hooks";
import {
  type CSSProperties,
  type TouchList as ReactTouchList,
  type TouchEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { db } from "../../db/db";
import { getMinuteOfDayFromDate, toMinuteOfDay } from "../../utils/time";
import { FaceBlurImage } from "../media/FaceBlurImage";
import { HourDial } from "./HourDial";
import styles from "./Timeline.module.css";

type Props = {
  onSelectMinute: (m: number, cell: HTMLElement) => void;
  showOnlyWithImages: boolean;
  blurImages: boolean;
};

const INITIAL_GRID_COLUMNS = 5;
const MIN_GRID_COLUMNS = 2;
const MAX_GRID_COLUMNS = 12;

function touchDistance(touches: ReactTouchList) {
  const [first, second] = [touches[0], touches[1]];
  return Math.hypot(
    second.clientX - first.clientX,
    second.clientY - first.clientY,
  );
}

function touchCenter(touches: ReactTouchList) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

export function Timeline({
  onSelectMinute,
  showOnlyWithImages,
  blurImages,
}: Props) {
  const [nowMod, setNowMod] = useState(() =>
    getMinuteOfDayFromDate(new Date()),
  );
  const [activeHour, setActiveHour] = useState(0);
  const [gridColumns, setGridColumns] = useState(INITIAL_GRID_COLUMNS);
  const gridRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>(Array(24).fill(null));
  const pinchRef = useRef<{ distance: number; columns: number } | null>(null);
  const wheelRef = useRef({ delta: 0, timer: null as number | null });
  const suppressClickUntilRef = useRef(0);

  useEffect(
    () => () => {
      if (wheelRef.current.timer !== null)
        window.clearTimeout(wheelRef.current.timer);
    },
    [],
  );

  const changeColumns = (
    nextColumns: number,
    focusX: number,
    focusY: number,
  ) => {
    const grid = gridRef.current;
    if (!grid || nextColumns === gridColumns) return;

    const anchor = document
      .elementFromPoint(focusX, focusY)
      ?.closest<HTMLElement>("[data-minute]");
    const anchorMinute = anchor?.dataset.minute;
    const anchorTop = anchor?.getBoundingClientRect().top;
    const oldRects = new Map<string, DOMRect>();
    grid.querySelectorAll<HTMLElement>("[data-minute]").forEach((cell) => {
      const rect = cell.getBoundingClientRect();
      if (rect.bottom >= 0 && rect.top <= window.innerHeight) {
        oldRects.set(cell.dataset.minute ?? "", rect);
      }
    });

    flushSync(() => setGridColumns(nextColumns));

    if (anchorMinute !== undefined && anchorTop !== undefined) {
      const nextAnchor = grid.querySelector<HTMLElement>(
        `[data-minute="${anchorMinute}"]`,
      );
      if (nextAnchor)
        grid.scrollTop += nextAnchor.getBoundingClientRect().top - anchorTop;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    grid.querySelectorAll<HTMLElement>("[data-minute]").forEach((cell) => {
      const before = oldRects.get(cell.dataset.minute ?? "");
      if (!before) return;
      const after = cell.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      const scale = before.width / after.width;
      if (
        Math.abs(dx) < 0.5 &&
        Math.abs(dy) < 0.5 &&
        Math.abs(scale - 1) < 0.01
      )
        return;
      cell.getAnimations().forEach((animation) => {
        animation.cancel();
      });
      cell.animate(
        [
          {
            transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
            transformOrigin: "top left",
          },
          {
            transform: "translate(0, 0) scale(1)",
            transformOrigin: "top left",
          },
        ],
        { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    });
  };

  useEffect(() => {
    const id = setInterval(
      () => setNowMod(getMinuteOfDayFromDate(new Date())),
      60_000,
    );
    return () => clearInterval(id);
  }, []);

  const thumbnails = useLiveQuery(
    async () => {
      const slots = await db.slots.filter((s) => !!s.photoId).toArray();
      const map = new Map<number, Blob>();
      await Promise.all(
        slots.map(async (slot) => {
          const photo = await db.photos.get(slot.photoId);
          if (photo) map.set(slot.minuteOfDay, photo.thumbnailBlob);
        }),
      );
      return map;
    },
    [],
    new Map<number, Blob>(),
  );

  const [thumbs, setThumbs] = useState(new Map<number, string>());
  const blobUrlCache = useRef(new Map<Blob, string>());
  useEffect(() => {
    const cache = blobUrlCache.current;
    const nextThumbs = new Map<number, string>();
    const retained = new Set<Blob>();
    thumbnails.forEach((blob, min) => {
      retained.add(blob);
      let url = cache.get(blob);
      if (!url) {
        url = URL.createObjectURL(blob);
        cache.set(blob, url);
      }
      nextThumbs.set(min, url);
    });
    setThumbs(nextThumbs);
    cache.forEach((url, blob) => {
      if (!retained.has(blob)) {
        URL.revokeObjectURL(url);
        cache.delete(blob);
      }
    });
  }, [thumbnails]);
  useEffect(
    () => () => {
      blobUrlCache.current.forEach((u) => {
        URL.revokeObjectURL(u);
      });
      blobUrlCache.current.clear();
    },
    [],
  );

  const visibleHours = showOnlyWithImages
    ? Array.from(
        new Set(Array.from(thumbs.keys(), (minute) => Math.floor(minute / 60))),
      ).sort((a, b) => a - b)
    : Array.from({ length: 24 }, (_, hour) => hour);

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
    const exact = blockRefs.current[h];
    const nearestHour = visibleHours.reduce<number | null>((nearest, hour) => {
      if (nearest === null) return hour;
      return Math.abs(hour - h) < Math.abs(nearest - h) ? hour : nearest;
    }, null);
    (
      exact ?? (nearestHour === null ? null : blockRefs.current[nearestHour])
    )?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    pinchRef.current = {
      distance: touchDistance(event.touches),
      columns: gridColumns,
    };
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const pinch = pinchRef.current;
    if (!pinch || event.touches.length !== 2) return;
    event.preventDefault();

    const scale = touchDistance(event.touches) / pinch.distance;
    // Logarithmic scaling feels even in both directions. A little hysteresis
    // keeps the grid from flickering around a column boundary.
    const continuousColumns = pinch.columns / scale ** 0.9;
    const hysteresis = continuousColumns > gridColumns ? 0.62 : 0.38;
    const nextColumns = Math.max(
      MIN_GRID_COLUMNS,
      Math.min(MAX_GRID_COLUMNS, Math.floor(continuousColumns + hysteresis)),
    );
    const center = touchCenter(event.touches);
    changeColumns(nextColumns, center.x, center.y);
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (!pinchRef.current || event.touches.length >= 2) return;
    pinchRef.current = null;
    suppressClickUntilRef.current = Date.now() + 350;
  };

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      wheelRef.current.delta += event.deltaY;
      if (Math.abs(wheelRef.current.delta) < 18) return;
      const direction = wheelRef.current.delta > 0 ? 1 : -1;
      wheelRef.current.delta = 0;
      const nextColumns = Math.max(
        MIN_GRID_COLUMNS,
        Math.min(MAX_GRID_COLUMNS, gridColumns + direction),
      );
      if (nextColumns === gridColumns) return;
      changeColumns(nextColumns, event.clientX, event.clientY);
      if (wheelRef.current.timer !== null)
        window.clearTimeout(wheelRef.current.timer);
      wheelRef.current.timer = window.setTimeout(() => {
        wheelRef.current.timer = null;
        wheelRef.current.delta = 0;
      }, 140);
    };
    grid.addEventListener("wheel", onWheel, { passive: false });
    return () => grid.removeEventListener("wheel", onWheel);
  }, [gridColumns]);

  const gridStyle = {
    "--grid-columns": gridColumns,
    "--cell-font-size": `clamp(10px, calc((100vw - 56px) * 0.42 / ${gridColumns}), 48px)`,
  } as CSSProperties;

  return (
    <div className={styles.container}>
      <div className={styles.body}>
        <div
          className={styles.gridScroll}
          ref={gridRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          {visibleHours.length === 0 && showOnlyWithImages && (
            <p className={styles.empty}>画像が追加されている時刻はありません</p>
          )}
          {visibleHours.map((hour) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: delegated click opens photo
            // biome-ignore lint/a11y/useKeyWithClickEvents: minute cells themselves are focusable buttons
            <div
              key={hour}
              ref={(el) => {
                blockRefs.current[hour] = el;
              }}
              className={styles.hourBlock}
              onClick={(e) => {
                if (Date.now() < suppressClickUntilRef.current) return;
                const cell = (e.target as HTMLElement).closest(
                  "[data-minute]",
                ) as HTMLElement | null;
                if (
                  cell?.dataset.minute !== undefined &&
                  cell.dataset.hasPhoto === "true"
                ) {
                  onSelectMinute(parseInt(cell.dataset.minute, 10), cell);
                }
              }}
            >
              <span className={styles.hourMarker}>
                {String(hour).padStart(2, "0")}
              </span>
              <div className={styles.minuteGrid} style={gridStyle}>
                {Array.from({ length: 60 }, (_, m) => m)
                  .filter(
                    (m) =>
                      !showOnlyWithImages || thumbs.has(toMinuteOfDay(hour, m)),
                  )
                  .map((m) => {
                    const mod = toMinuteOfDay(hour, m);
                    const thumb = thumbs.get(mod);
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
                        {thumb && (
                          <FaceBlurImage
                            src={thumb}
                            alt=""
                            className={styles.cellThumb}
                            fallbackBlurClassName={styles.blurred}
                            blurPx={4}
                            enabled={blurImages}
                          />
                        )}
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

      <HourDial activeHour={activeHour} onScrub={scrollToHour} />
    </div>
  );
}
