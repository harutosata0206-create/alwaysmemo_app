# ver0.1.8 スペルチェック実現性調査

調査日: 2026-09-18。対象: Windows版 AlwaysMemo `ver0.1.8`。
この文書は実装・提供済みの機能を示すものではない。調査後、ver0.1.8ではスペルチェック設定を削除し、編集欄のブラウザー標準校正を無効化した。

## 実機で確認したこと

- 言語一覧には日本語・英語（米国）・韓国語がある。ただし入力言語の導入と校正器の提供は別である。
- Windows Spell Checking API の `ISpellCheckerFactory::IsSupported` は `en-US=true`、`ko-KR=false`、`ko=false` を返した。`get_SupportedLanguages` にも韓国語はない。
- 制限のない診断環境で `en-US` の校正器を作成できた。`Check("I understond this.")` は開始位置2・長さ10の誤りを返し、`Suggest("understond")` は `understand`、`understood`、`understands` を返した。
- `ko-KR` の校正器生成は `E_INVALIDARG` で失敗した。これらはこのPCの結果であり、全Windows環境の断定ではない。
- WebView2の診断用ブラウザーフラグでは英語の赤線・右クリック候補を再現できたが、Microsoftは本番でのフラグ使用を推奨していない。プロファイル設定の直接編集も採用しない。
- Windows APIは外部の校正プロバイダーを別プロセスで読み込む場合がある。製品化時には提供元と通信挙動を確認する。

## 現行エディターとの統合範囲

`src/App.tsx` の編集欄は `contentEditable` で、以前の設定はHTMLの `spellcheck` 属性を切り替えるだけだった。Windows APIは誤り位置と候補を返すが、AlwaysMemoの画面に赤線や候補を描画する機能は提供しない。

本格的な統合には、次の処理と回帰試験が必要になる。

1. 入力確定後に非同期・間引きで校正する。IME変換中は検査せず、古い結果を破棄する。
2. APIの文字位置をHTMLのテキストノードへ対応付け、赤線を表示する。保存対象のHTMLやカーソル位置、Undo履歴を校正用の装飾で変えない。
3. 右クリック位置の単語から候補を表示し、選択範囲を保持して置換する。既存の検索ハイライト、貼り付け、ファイル保存・復元と共存させる。
4. オフ時は結果と候補を即時に消す。メモ本文を通信・計測・ログへ渡さず、複数ウィンドウでも処理量を制限する。

## 英語・韓国語対応の判断

- 英語: Windows APIを利用する経路は実機で確認できた。ただし上記の編集欄統合は未実装。
- 韓国語: このPCではWindows APIだけでは実現できない。別のローカル校正器・辞書が必要となる可能性が高い。候補の[Hunspell韓国語辞書](https://github.com/spellcheck-ko/hunspell-dict-ko)は配布物にGPLv3等の条件を示しており、採用前に品質・配布サイズ・ライセンスを確認する。現時点では依存関係や辞書を追加しない。
- 他言語: 将来の追加を想定し、校正器の選択とUI表示を分離する。ただし今回、未使用の抽象化は実装しない。

概算は、英語のWindows API接続と編集欄統合・回帰試験で約1～2週間、韓国語の校正器選定・統合・品質評価で追加約1～2週間。辞書の再配布条件が未確定なら日程も確定できない。ver0.1.8の機能削除とは別タスクとして扱う。

参考: [Windows Spell Checking API](https://learn.microsoft.com/en-us/windows/win32/api/spellcheck/nn-spellcheck-ispellcheckerfactory)、[APIの安全性とエラー処理](https://learn.microsoft.com/en-us/windows/win32/intl/about-the-spell-checker-api)、[WebView2ブラウザーフラグ](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)。
