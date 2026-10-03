# PWA 写真スロットアプリ 実装仕様書

## 1. 概要

1日の1440分を固定スロットとして扱い、各「時刻」に対して1枚の写真を登録する写真アプリを実装する。

ユーザーは、日付順に写真を蓄積するのではなく、以下のように「1日の中の時刻」を単位として写真を収集する。

- 06:17
- 12:03
- 17:51
- 23:48

同一時刻へ新しい写真を登録した場合は、既存の写真を置き換える。
アプリは PWA として実装し、モバイルブラウザ、特に iPhone / Android での利用を主対象とする。

# 2. MVP のゴール

以下を実現する。

1. 1日24時間を一覧表示する
2. 各時間帯を押すと、その時間帯が60分のスロットに展開される
3. 各分スロットについて、写真登録済み / 未登録を視覚的に確認できる
4. カメラで撮影した写真を現在時刻のスロットに登録できる
5. 写真ライブラリから写真を選択し、EXIF の撮影時刻に対応するスロットへ登録できる
6. 複数枚をまとめてインポートできる
7. 同一時刻への再登録で既存の写真を置き換えられる
8. IndexedDB にデータを保存し、リロード後も状態を保持する
9. PWA としてホーム画面にインストールできる
10. オフラインでも登録済み写真を閲覧できる

# 4. 技術スタック

以下を基本構成とする。

- React
- TypeScript
- Vite
- PWA
- `vite-plugin-pwa`
- IndexedDB
- Dexie
- `exifr`
- CSS Modules または通常の CSS
- 必要なら Motion / Framer Motion

外部 UI ライブラリは原則使用しない。
UI はモバイルファーストで独自実装する。

# 5. 基本データモデル

## 5.1 時刻スロット

1日は1440個の固定スロットからなる。

```ts
type MinuteOfDay = number;
// 0 ... 1439
```

変換関数を用意する。

```ts
function toMinuteOfDay(hour: number, minute: number): MinuteOfDay {
  return hour * 60 + minute;
}

function fromMinuteOfDay(value: MinuteOfDay): {
  hour: number;
  minute: number;
} {
  return {
    hour: Math.floor(value / 60),
    minute: value % 60,
  };
}
```


## 5.2 Photo

```ts
type PhotoRecord = {
  id: string;

  // 撮影日時
  capturedAt: string | null;

  // 0..1439
  minuteOfDay: number;

  // サムネイル Blob
  thumbnailBlob: Blob;

  // 必要に応じて表示用のやや大きな画像
  previewBlob?: Blob;

  // 元画像ファイル名
  originalFileName?: string;

  // MIME type
  mimeType?: string;

  // 元画像サイズ
  originalWidth?: number;
  originalHeight?: number;

  // インポート日時
  importedAt: string;

  // 日時取得元
  capturedAtSource:
    | "DateTimeOriginal"
    | "CreateDate"
    | "lastModified"
    | "currentTime"
    | "manual";
};
```


## 5.3 Slot

```ts
type SlotRecord = {
  minuteOfDay: number;
  photoId: string;
};
```

写真とスロットを分離し、各スロットは写真を1枚だけ参照する。

例：

```text
14:32
  |
  +-- photoId -> photo-B
```


# 6. IndexedDB

Dexie を使用する。

```ts
import Dexie, { type Table } from "dexie";

class AppDB extends Dexie {
  photos!: Table<PhotoRecord, string>;
  slots!: Table<SlotRecord, number>;

  constructor() {
    super("minute-photo-app");

    this.version(1).stores({
      photos: `
        id,
        minuteOfDay,
        capturedAt,
        importedAt
      `,
      slots: `
        minuteOfDay,
        photoId
      `,
    });
  }
}

export const db = new AppDB();
```

`minuteOfDay` は必ず index を張る。

写真取得：

```ts
const slot = await db.slots.get(minuteOfDay);
const photo = slot ? await db.photos.get(slot.photoId) : undefined;
```


# 7. 画像保存方針

MVP では元画像を IndexedDB にそのまま保存しない。

インポート時に以下を生成する。

- thumbnail: 最大辺 320px 程度
- preview: 最大辺 1280px 程度

推奨：

```text
thumbnail
320px
WebP
quality 0.75〜0.8

preview
1280px
WebP
quality 0.8〜0.85
```

用途：

```text
thumbnail
→ 60分グリッド
→ 写真一覧

preview
→ 写真詳細
→ Current Best 表示
```

元画像は処理後に保持しない。


# 8. 大量写真インポート

500枚程度の一括インポートを想定する。

重要：

500ファイルを同時に `Promise.all()` で処理しないこと。

禁止：

```ts
await Promise.all(files.map(processImage));
```

基本は逐次処理とする。

```ts
for (const file of files) {
  await processImage(file);
}
```

または最大3枚程度の限定並列処理としてもよい。

目的：

- メモリ使用量抑制
- Safari のクラッシュ回避
- 画像デコードの同時実行抑制


# 9. EXIF 日時取得

`exifr` を使用する。

優先順位：

```text
1. DateTimeOriginal
2. CreateDate
3. File.lastModified
4. manual
```

例：

```ts
const exif = await exifr.parse(file, {
  pick: [
    "DateTimeOriginal",
    "CreateDate",
    "Orientation",
  ],
});
```

撮影日時決定：

```ts
const capturedAt =
  exif?.DateTimeOriginal ??
  exif?.CreateDate ??
  new Date(file.lastModified);
```

ただし `lastModified` は撮影日時とは限らない。

その場合：

```ts
capturedAtSource = "lastModified";
```

として保存する。

UI 上で必要なら、

```text
撮影時刻を取得できなかったため、
ファイル日時を使用しました。
```

と表示できるようにする。


# 10. タイムゾーン方針

スロット決定には「撮影時のローカル時刻」を使用する。

例：

シンガポールで現地18:42に撮影した写真は、

```text
18:42
```

スロットに保存する。

日本時間へ変換して19:42にしない。

したがって、スロット決定時は UTC 変換を行わない。

EXIF から取得した、

```text
hour
minute
```

をそのまま利用する。


# 11. メイン画面

## 11.1 通常状態

画面全体を24個の時間帯として縦方向に表示する。

概念：

```text
00
01
02
03
...
22
23
```

各時間帯は画面高さに応じて均等配置する。

基本として、

```css
height: 100dvh;
display: grid;
grid-template-rows: repeat(24, 1fr);
```

を検討する。

ただし下部 safe area を考慮すること。

```css
padding-bottom: env(safe-area-inset-bottom);
```


# 12. Hour Row

各 hour row は以下の情報を持つ。

```text
14   ■■■■□□□□■■■...
```

その時間内60スロットの充足状況を簡略表示してもよい。

最低限：

- hour label
- 写真登録数
- fill ratio

例：

```text
14          37 / 60
```


# 13. Hour 展開

ユーザーが hour row に指を置いたら、その時間帯を展開する。

React state：

```ts
const [expandedHour, setExpandedHour] =
  useState<number | null>(null);
```

通常は24 row。

展開時：

```text
13
-------------
14

00 01 02 03 04 05
06 07 08 09 10 11
12 13 14 15 16 17
...
54 55 56 57 58 59

-------------15
```


# 14. Minute Grid

60分を、

```text
6列 × 10行
```

で表示する。

```css
display: grid;
grid-template-columns: repeat(6, 1fr);
grid-template-rows: repeat(10, 1fr);
```

各 cell は十分なタッチ領域を確保する。

最低44px程度を理想とするが、画面サイズに合わせて調整してよい。


# 15. Minute Slot 表示

写真なし：

```text
32
```

写真あり：

```text
+------+
|photo |
| 32   |
+------+
```

登録写真の thumbnail を background / img として表示する。

現在時刻の場合は明示的に強調する。

例：

```text
NOW
32
```


# 16. Pointer 操作

Touch Event ではなく Pointer Events を優先する。

基本操作：

```text
pointerdown
↓
hour 展開

pointermove
↓
指が現在どの minute cell 上にいるか更新

pointerup
↓
その minute を選択
```

これにより、

```text
14時を押す
↓
展開
↓
指を14:32まで滑らせる
↓
離す
```

という操作を可能にする。

一方で通常のタップ操作も残す。


# 17. アニメーション

hour 展開は「にゅっ」と開く感覚を重視する。

要求：

- 200〜350ms 程度
- ease-out 系
- レイアウトジャンプを極力避ける
- 他の hour row が滑らかに上下へ移動する

可能なら Motion を使用する。

ただし MVP では CSS transition でも構わない。


# 18. Minute 詳細画面

minute slot を選択すると詳細画面 / sheet を表示する。

## 空の場合

```text
14:32

No photo yet

[ 撮影する ]

[ 写真から選ぶ ]
```


## 写真ありの場合

```text
14:32

PHOTO

+----------------+
|                |
|     photo      |
|                |
+----------------+

Other photos: 3

[A] [B] [C]

[ 写真を追加 ]
```


# 19. カメラ撮影

最低限の実装として file input を使用可能。

```html
<input
  type="file"
  accept="image/*"
  capture="environment"
/>
```

撮影された場合は撮影時の現在時刻を使用する。

```ts
const now = new Date();

const minuteOfDay =
  now.getHours() * 60 +
  now.getMinutes();
```

`capturedAtSource`：

```ts
"currentTime"
```

とする。

カメラで撮影した写真は、その時点の minute slot に登録する。


# 20. 写真選択

通常の file input を利用。

```html
<input
  type="file"
  accept="image/*"
/>
```

複数選択：

```html
<input
  type="file"
  accept="image/*"
  multiple
/>
```

選択された写真ごとに、

1. EXIF 取得
2. 撮影時刻決定
3. minuteOfDay 決定
4. thumbnail 生成
5. preview 生成
6. IndexedDB 保存

を行う。


# 21. 一括インポート画面

500枚程度の選択を想定する。

UI：

```text
Importing photos

183 / 500

████████░░░░░░

Current:
IMG_3818.JPG
```

キャンセル可能にしてもよいが、MVP では必須ではない。

処理中に UI が完全に固まらないようにする。

必要なら以下を利用する。

```ts
await new Promise(requestAnimationFrame);
```

または一定枚数ごとに event loop へ制御を返す。


# 22. インポート後の写真決定

写真をインポートした場合：

```text
photoId = importedPhoto.id
```

とする。

既に写真がある場合は、新しい写真で置き換える。

例：

```text
14:32

[new]
```

置き換え前の写真レコードは削除する。一括インポートで同じ minute の写真が複数ある場合は、最後に処理した1枚を残す。


# 23. 写真の変更

slot に新しい写真を登録すると、

```ts
await db.slots.put({
  minuteOfDay,
  photoId: selectedPhoto.id,
});
```

として写真を変更する。変更前の写真レコードは削除する。


# 24. Current Time

ホーム画面上で現在時刻を強調表示する。

例：

```text
14
  ...
  32 ← NOW
```

1分ごとに更新する。

```ts
setInterval(..., 60_000)
```

正確な秒同期は不要。


# 25. ホーム画面上の統計

最低限：

```text
527 / 1440
36.6%
```

を表示する。

充足数は、

```text
photoId が存在する Slot 数
```

とする。


# 26. PWA

以下を設定する。

- manifest
- service worker
- standalone display
- theme color
- app icon
- offline shell

例：

```json
{
  "name": "Minute Photo",
  "short_name": "Minute",
  "display": "standalone",
  "start_url": "/",
  "orientation": "portrait"
}
```


# 27. オフライン動作

以下はオフラインで動作すること。

- 24時間一覧
- minute 展開
- 登録済み写真表示
- 登録済み写真表示
- 写真変更
- カメラ / ファイルからのローカルインポート

サーバ通信は MVP では使用しない。


# 28. パフォーマンス要件

500枚程度をインポートしても、通常操作が重くならない構造とする。

重要原則：

## DOM

通常時：

```text
24 hour rows
```

のみ描画する。

1440 slot を常時描画しない。

展開中の1時間のみ、

```text
60 minute slots
```

を描画する。


## 画像

オリジナル画像を大量にメモリ保持しない。

インポート処理：

```text
File
↓
EXIF
↓
decode
↓
thumbnail / preview
↓
IndexedDB
↓
File 参照解放
```

とする。


## Object URL

`URL.createObjectURL()` を使用した場合、必ず不要になった時点で、

```ts
URL.revokeObjectURL(url);
```

する。


# 29. 画像生成

画像縮小には Canvas または `createImageBitmap()` を利用する。

可能なら、

```ts
createImageBitmap(file)
```

を利用する。

orientation を正しく扱うこと。


# 30. 画面構成

以下の4画面程度に整理する。

```text
/
Timeline

/import
Bulk Import

/minute/:minuteOfDay
Minute Detail

/photo/:photoId
Photo Detail
```

ただし modal / bottom sheet にしてもよい。

MVP では SPA とする。


# 31. コンポーネント案

```text
src/
  components/
    Timeline.tsx
    HourRow.tsx
    MinuteGrid.tsx
    MinuteCell.tsx
    MinuteDetail.tsx
    PhotoGrid.tsx
    PhotoCard.tsx
    ImportProgress.tsx

  features/
    camera/
      CameraInput.tsx

    import/
      importPhotos.ts
      parsePhotoMetadata.ts
      createThumbnail.ts

  db/
    db.ts
    types.ts

  utils/
    time.ts
    image.ts

  App.tsx
```


# 32. 必須ユーティリティ

```ts
toMinuteOfDay(hour, minute)

fromMinuteOfDay(minuteOfDay)

formatMinuteOfDay(minuteOfDay)
// 872 -> "14:32"

getMinuteOfDayFromDate(date)

parsePhotoCapturedAt(file)

createThumbnail(file)

createPreview(file)
```


# 33. UI 方針

デザインはシンプルにする。

写真が主役であるため、UI の装飾は抑える。

基本：

- 白または黒系の単色背景
- 最低限の罫線
- 大きな写真
- 小さな時刻表示

Instagram 的なフィードにはしない。

「1440マスを攻略していく盤面」であることが伝わる UI とする。


# 34. 重要な UX

アプリを開いたとき、

```text
現在時刻
↓
その hour
↓
現在 minute
```

がすぐ認識できること。

ただし自動的に hour を展開する必要はない。

現在時刻の row / cell を明示的に強調する。


# 35. 初期データ

SlotRecord を1440件あらかじめ作成する必要はない。

写真登録時にのみ作成する。

つまり DB には、

```text
写真のある slot のみ存在
```

してよい。

表示時：

```ts
const slot =
  await db.slots.get(minuteOfDay);

const filled = !!slot?.photoId;
```

とする。


# 36. 削除

写真詳細画面から削除可能にする。

写真を削除した場合は、写真レコードと SlotRecord を削除する。


# 37. エラー処理

最低限、以下を扱う。

- EXIF の解析失敗
- 画像 decode 失敗
- IndexedDB 保存失敗
- unsupported image
- storage quota exceeded

1枚の処理失敗で一括インポート全体を止めない。

最終的に、

```text
Imported: 493
Failed: 7
```

と表示する。


# 38. iOS Safari 注意事項

iPhone Safari / standalone PWA を主要対象としてテストする。

特に確認する。

- `100vh` ではなく `100dvh`
- safe area
- file input
- camera capture
- IndexedDB
- Blob
- WebP
- object URL
- standalone mode
- pull-to-refresh による誤操作

必要に応じて、

```css
overscroll-behavior: none;
touch-action: manipulation;
```

等を利用する。

Pointer gesture を実装する領域では適切な `touch-action` を設定する。


# 39. MVP 完了条件

以下がすべて動作すれば MVP 完了とする。

## Timeline

- 24時間が1画面に表示される
- hour を押すと60分表示へ展開される
- 展開アニメーションがある
- minute cell を選択できる

## Import

- カメラから写真登録可能
- 写真ファイルを選択可能
- 複数枚選択可能
- EXIF を読める
- 時刻スロットへ自動分類される
- 500枚程度を処理できる

## Storage

- IndexedDB 保存
- リロード後も写真が残る
- 登録写真が保持される

## Slot

- 空 / 登録済みが分かる
- 同一時刻に写真を1枚だけ保持できる
- 写真を変更できる

## PWA

- installable
- standalone 起動
- offline 起動


# 40. 実装優先順位

以下の順で実装する。

## Phase 1

データ層。

- Dexie
- PhotoRecord
- SlotRecord
- time utilities

## Phase 2

Timeline。

- 24 hour
- hour 展開
- 60 minute grid

## Phase 3

ダミー画像を使って slot / best photo UI を完成させる。

## Phase 4

単一写真インポート。

- file input
- EXIF
- thumbnail
- IndexedDB

## Phase 5

複数写真インポート。

- progress
- error handling

## Phase 6

カメラ。

## Phase 7

PWA 対応。

## Phase 8

アニメーションとモバイル操作改善。


# 41. Claude Code 向け実装方針

最初から全機能を一度に実装しないこと。

まず、

```text
Phase 1〜3
```

を完成させ、ダミーデータで Timeline 操作が成立することを確認する。

その後、画像インポートを追加する。

コードは以下を重視する。

- TypeScript strict
- 小さな関数
- UI と DB 処理を分離
- 画像処理を utility 化
- React component 内で画像処理しない
- DB query を component 内へ散在させない
- object URL の leak を避ける
- 500枚一括処理でも全ファイルを同時 decode しない


# 42. 将来拡張を妨げない設計

将来的には以下を追加する可能性がある。

- Cloud sync
- login
- Capacitor
- PhotoKit
- Android MediaStore
- 共有
- yearly statistics
- slot competition
- import from cloud storage

そのため、

```text
Photo
Slot
```

のドメインモデルは UI から独立させる。

特に、

```ts
photoId
```

を PhotoRecord 内に持たせず SlotRecord 側に持つこと。


# 43. 最重要原則

このアプリの中心概念は、

```text
日付 → 写真
```

ではない。

```text
時刻 → 写真
```

である。

各時刻に保持する写真は1枚だけとし、再登録時は置き換えること。

UI、DB、インポート処理のすべてをこのモデルに合わせて実装すること。
