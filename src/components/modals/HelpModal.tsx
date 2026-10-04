import { useLiveQuery } from "dexie-react-hooks";
import { MdHelpOutline } from "react-icons/md";
import { db } from "../../db/db";
import styles from "./HelpModal.module.css";
import { Modal, modalStyles } from "./Modal";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function HelpModal({ open, onClose }: Props) {
  const photoCount = useLiveQuery(
    () => db.slots.filter((slot) => !!slot.photoId).count(),
    [],
    0,
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ヘルプ"
      icon={<MdHelpOutline aria-hidden="true" />}
      labelledBy="help-title"
    >
      <div className={styles.guide}>
        <section>
          <h3>{photoCount > 0 ? photoCount : "???"} 枚 / 1440 枚</h3>
          <p>
            60分 × 24時間 = <b>1440 分</b>のスロットが用意されています。1
            分につき残せる写真は、<b>その時刻に撮られた 1 枚だけ</b>
            です（撮影日は問いません。2 秒以内の動画を残すこともできます）。
          </p>
          <p>
            よりお気に入りの写真に更新しながら、1440
            分のスロットを埋めていきましょう。
          </p>
          <ul>
            <li>開発：いなにわうどん（@kyoto_inaniwa）</li>
            <li>原案：椎名（@s7tya）</li>
          </ul>
        </section>

        <section>
          <h3>写真を追加する</h3>
          <p>
            右下の ＋
            ボタンを長押しするとメニューが開きます。選びたい項目の方向へドラッグして、指を離してください。
          </p>
          <ul>
            <li>
              <strong>写真</strong>
              ：写真を撮影するか、端末内の写真を選択します（複数選択可）。撮影時刻のスロットが埋まっている場合は、写真を更新するかの確認が表示されます。
            </li>
            <li>
              <strong>オプション</strong>
              ：記録済みの時刻だけを表示したり、画像一覧を書き出したり、データをインポート／エクスポートしたりできます。
            </li>
          </ul>
        </section>

        <section>
          <h3>写真を見る</h3>
          <p>
            サムネイルをタップすると写真を拡大表示します。拡大表示中に左右へスワイプすると、前後の写真へ移動できます。
          </p>
          <p>
            画面右端の時計を長押ししたまま上下へドラッグすると、表示する時間帯を移動できます。
          </p>
        </section>

        <button
          type="button"
          className={`${modalStyles.secondaryButton} ${styles.closeButton}`}
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
    </Modal>
  );
}
