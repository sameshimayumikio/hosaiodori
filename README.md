# ユビキタス伝芸 — 野行の宝財踊り WebAR

「ユビキタス伝芸／野行の宝財踊り」のWebAR実装用リポジトリです。

アクリルスタンドそのものを画像ターゲットとして認識し、対応する透過動画をWebAR上で再生します。  
実装は **MindAR 1.2.5 + Three.js 0.160.0**、公開は **GitHub Pages** を使用します。

## AR構成

最終構成は14種類です。

- 単体10種: `/S01-K7M4/` ～ `/S10-X8H3/`
- ペア3種: `/P23-M7Q4/`、`/P45-V3K8/`、`/P710-C5R2/`
- 全員集合1種: `/ALL-X8M4/`

公開URL IDは購入者向けページのパスに使用し、`assets/` 以下の素材名・人物番号は制作管理上の番号を維持します。

## 共通実装

### 単体

共通ランタイム:

```
js/ar.js
```

### 全員集合（本番円弧版）

本番 URL: `/ALL-X8M4/`（`js/ar-all-arc.js`）  
テスト URL: `/ALL-ARC-TEST/`（`js/ar-all-arc-test.js`）

- **本番**：6番 ささらのアクリルスタンドを画像ターゲットとして使用（`assets/06/06_target_crop_800.mind`）。テスト版は引き続き5番を使用
- 動画: `assets/all/all_dance.mp4`（SBS RGB/Alpha）
- 6番を認識して動画を読み込んだ後、赤い再生アイコンを表示
- 再生を開始すると認識位置を基準に映像を固定し、その後はジャイロで左右を見渡せる（位置移動の追跡は行わない）
- 再生終了後は同じ赤い再生アイコンに戻り、再認識せずに再生可能
- 円弧角度70°、高さ4.0、X補正 -0.5、Y補正 +0.5、6番基準位置0.55（動画内の位置は暫定推定値。実機で微調整）
- ピンチズーム0.12〜3倍、ダブルタップで1倍に戻す
- 再生中に限り、左上の左右方向アイコンと右上のピンチ操作案内を表示
- 本番側の表示・姿勢設定は `ALL-X8M4/index.html` の `window.ALL_ARC_CONFIG` で管理

### ペア

共通ランタイム:

```
js/ar-pair-two-targets.js
```

ペアは2体を別ターゲットとして同時認識します。

- `maxTrack: 2`
- 2体とも認識したときだけペアARを有効化
- target A を位置・向き・大きさの基準にする
- target B はもう1体の存在確認用
- 02 + 03 → 02がtarget A
- 04 + 05 → 04がtarget A
- 07 + 10 → 07がtarget A

## MindAR・追跡設定

全14ページは公式 **MindAR 1.2.5** をCDNから読み込みます。  
認識アルゴリズム自体は公式版を使用し、アプリ側の追跡・初期安定化のみ共通ランタイムで調整しています。

共通設定:

```js
warmupTolerance: 5
missTolerance: 30
filterMinCF: 0.00001
filterBeta: 0.001
settleBeforeVideoLoadMs: 1000
resetTrackingFilterBeforeLoad: true
```

初回認識時は、認識後に約1000ms追跡だけを続けて姿勢を落ち着かせ、その時点で追跡フィルタをリセットしてから動画ロードを開始します。  
これは初回認識時にAR姿勢が大きく歪む現象を減らすための処理です。

## 動画ロード・再生（単体・ペアの基本動作）

- SBS MP4
- 左半分: RGB映像
- 右半分: アルファマスク
- 音声はMP4内
- 非ループ
- マーカーを見失うと一時停止
- 再認識時は先頭へ戻る
- 認識後は「認識成功！ ちょっと待ってね」を表示
- 動画先頭 **4秒分** がバッファされたら、先頭フレームと再生ボタンを表示
- 再生はユーザータップで開始

## 各ページの個別設定

単体・ペアは各 `index.html` の `window.AR_CONFIG` で以下を個別調整します。全員集合は上記 `window.ALL_ARC_CONFIG` を使用します。

- `imageTargetSrc`
- `videoSrc`
- `planeAspect`
- `planeScale`
- `planeOffsetX`
- `planeOffsetY`
- `brightness`

ペアのみ:

- `targetIndexA`
- `targetIndexB`

追跡・初期安定化設定は原則として共通ランタイム側で管理し、ページ側には重複記述しません。

## 現在使用中のターゲット

| AR | 使用中の .mind |
|---|---|
| 01 | `assets/01/01_target_crop_800.mind` |
| 02 | `assets/02/02_target_crop2_800.mind` |
| 03 | `assets/03/03_target_crop_800.mind` |
| 04 | `assets/04/04_target_crop_800.mind` |
| 05 | `assets/05/05_target_800.mind` |
| 06 | `assets/06/06_target_crop_800.mind` |
| 07 | `assets/07/07_target_crop_800.mind` |
| 08 | `assets/08/08_target_crop_800.mind` |
| 09 | `assets/09/09_target_crop_800.mind` |
| 10 | `assets/10/10_target_800.mind` |
| 02+03 | `assets/pair-02-03/pair-02-03_target_crop_800.mind` |
| 04+05 | `assets/pair-04-05/pair-04-05_target_crop_800.mind` |
| 07+10 | `assets/pair-07-10/pair-07-10_target_crop_800.mind` |
| ALL | `assets/06/06_target_crop_800.mind`（6番と共用） |

ペア用 `.mind` は2枚のターゲット画像を同時にコンパイルし、target Aを先、target Bを後に入れます。

## 現在の動画配置状況

| AR | MP4 |
|---|---|
| 01–05 | 配置済み |
| 06–10 | 未配置 |
| 02+03 | 配置済み |
| 04+05 | 配置済み |
| 07+10 | 未配置 |
| ALL | 配置済み（`assets/all/all_dance.mp4`） |

未配置ページは入口と設定だけ存在し、必要アセット追加後に完成します。

## 全員集合ARデモ

デモ URL: `/DEMOALL-K8R6/`

- ペア3種と共通の `demo-access.json` を利用。設定中の期間は2026年10月16日10:00〜11月13日17:00（日本時間）
- `ALL-X8M4/` の設定をページ読込時に取得し、同一の `js/ar-all-arc.js` を使用（6番「ささら」基準の集合AR）
- 期間外は「このARデモは現在利用できません」と表示し、開始不可
- ペアデモと同様、時間判定はページ読込時のみ。既に開いているページの再生は終了時刻でも強制停止しない
- 本番・単体・ペアのページには変更を加えない

## 販売会場用ペアARデモ

ペア3種には、購入者用URLとは別のデモ専用ページを用意します。  
デモページは解除コードを使わずにペアARを起動し、共通の `demo-access.json` で利用可否を制御します。

```json
{
  "enabled": false,
  "startAt": null,
  "endAt": null
}
```

- `enabled: false` → 常時停止
- `enabled: true` かつ日時未指定 → 常時利用可
- `enabled: true` かつ `startAt` / `endAt` 指定 → 指定時間内のみ利用可
- 日時は `2026-10-04T09:30:00+09:00` のようなISO 8601形式で指定
- 停止中は「このARデモは現在利用できません」と表示
- デモページから購入者用URLへは遷移しない
- デモページ自身には `AR_CONFIG` を持たず、対応する本番ペアページの `AR_CONFIG` を起動時に読み込む
- そのため本番側で `planeScale`、位置、明るさ、ターゲット、動画などを変更すれば、デモ側にも自動反映される

通常時は `enabled: false` を維持します。

## ディレクトリ構成

```
hosaiodori/
├── S01-K7M4/ ～ S10-X8H3/
├── P23-M7Q4/
├── P45-V3K8/
├── P710-C5R2/
├── ALL-X8M4/
├── DEMOALL-K8R6/
├── ALL-ARC-TEST/    # 円弧版テスト
├── assets/
│   ├── 01/ ～ 10/
│   ├── pair-02-03/
│   ├── pair-04-05/
│   ├── pair-07-10/
│   └── all/
├── css/
│   └── style.css
├── js/
│   ├── ar.js
│   ├── ar-pair-two-targets.js
│   ├── ar-all-arc.js
│   └── ar-all-arc-test.js
└── README.md
```

## バックアップ

初期の動作デモは `demo-working-v1` ブランチに保存しています。  
`main` は現在の本番制作・調整用です。
