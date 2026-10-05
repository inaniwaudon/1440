import type { PointerEvent } from "react";
import { Fragment, useRef, useState } from "react";
import styles from "./HourDial.module.css";

type Props = {
  activeHour: number;
  onScrub: (hour: number) => void;
};

// px 単位
const DIAL_SIZE = 420;
// 「9 時」（左）方向を中心とした ±60°
const ARC_HALF_DEG = 60;
// 24 時間を 2*ARC_HALF_DEG の弧上に扇形に配置する。
// 両端を含み、h=0 は -ARC_HALF_DEG、h=23 は +ARC_HALF_DEG。
const DEG_PER_HOUR = (2 * ARC_HALF_DEG) / 23;

// 左（9 時）軸からのオフセット（負 = 上、正 = 下）を、+x 軸基準（y 下向き）で測った
// CSS 的・数学的な角度へ変換する。180° は左方向を示す。
// y 下向きの座標系では、180°→270° が左下（sin が正 → 下）、
// 90°→180° が左上に対応するため、負のオフセット（上）は mathAngle > 180 となる。
const offsetToMathAngle = (offsetDeg: number): number => {
  return 180 - offsetDeg;
};

export const HourDial = ({ activeHour, onScrub }: Props) => {
  const [open, setOpen] = useState(false);
  const [displayHour, setDisplayHour] = useState(activeHour);
  const dialRef = useRef<HTMLDivElement>(null);

  // 操作中でない間は、外部から渡された activeHour に displayHour を同期させる
  if (!open && displayHour !== activeHour) {
    setDisplayHour(activeHour);
  }

  const hourFromPointer = (clientX: number, clientY: number): number => {
    const dial = dialRef.current;
    if (!dial) {
      return displayHour;
    }
    const rect = dial.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;
    // +x 軸基準（y 下向き）での数学的角度。180° が左方向
    const mathAngle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
    // 左軸からのオフセット。負 = 上、正 = 下。
    let offset = 180 - mathAngle;
    while (offset > 180) {
      offset -= 360;
    }
    while (offset < -180) {
      offset += 360;
    }
    const clamped = Math.max(-ARC_HALF_DEG, Math.min(ARC_HALF_DEG, offset));
    // オフセット -60°（左上）が 0 時、+60°（左下）が 23 時に対応する
    const hour = Math.round((clamped + ARC_HALF_DEG) / DEG_PER_HOUR);
    return Math.max(0, Math.min(23, hour));
  };

  const handlePointerDown = (event: PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setOpen(true);
    setDisplayHour(activeHour);
    // 注意：
    // ポインタダウン時にスクラブしてはならない。ドットが軸からずれた位置にあるため、
    // そのままだとドットの角度に応じて時刻がスナップしてしまう。実際の移動が発生するまで待つ
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!open) {
      return;
    }
    const hour = hourFromPointer(event.clientX, event.clientY);
    if (hour !== displayHour) {
      setDisplayHour(hour);
      onScrub(hour);
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // 無視
    }
    setOpen(false);
  };

  const radius = DIAL_SIZE / 2;
  const labelRadius = radius - 18;
  const majorTickRadius = radius - 43;

  return (
    <div
      className={styles.root}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {!open ? (
        <div
          className={styles.dot}
          role="img"
          aria-label={`${String(activeHour).padStart(2, "0")}:00`}
        >
          <span className={styles.clockNumber}>
            {String(activeHour).padStart(2, "0")}
          </span>
          <span
            className={styles.hourHand}
            style={{
              transform: `translateX(-50%) rotate(${(activeHour % 12) * 30}deg)`,
            }}
          />
          <span className={styles.minuteHand} />
          <span className={styles.clockPin} />
        </div>
      ) : (
        <div
          className={styles.dialWrap}
          style={{ ["--dial-size" as string]: `${DIAL_SIZE}px` }}
        >
          <div className={styles.dial} ref={dialRef}>
            {Array.from({ length: 24 }, (_, h) => {
              // -60 〜 +60
              const offset = -ARC_HALF_DEG + h * DEG_PER_HOUR;
              const mathAngle = offsetToMathAngle(offset);
              const rad = (mathAngle * Math.PI) / 180;
              const x = Math.cos(rad) * labelRadius;
              const y = Math.sin(rad) * labelRadius;
              const isMajor = h % 3 === 0;
              const isSelected = h === displayHour;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: static 24-hour list, order fixed
                <Fragment key={h}>
                  {isMajor && (
                    <span
                      className={styles.majorTickMark}
                      style={{
                        transform: `translate(-50%, -50%) translate(${Math.cos(rad) * majorTickRadius}px, ${Math.sin(rad) * majorTickRadius}px) rotate(${mathAngle}deg)`,
                      }}
                    />
                  )}
                  <div
                    className={`${styles.tick} ${isSelected ? styles.tickActive : ""}`}
                    style={{ transform: `translate(${x}px, ${y}px)` }}
                  >
                    <span
                      className={[
                        styles.tickInner,
                        isMajor ? styles.tickMajor : "",
                        isSelected ? styles.tickSelected : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {String(h).padStart(2, "0")}
                    </span>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
