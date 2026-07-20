# Font delivery research

Issue #17では、日本語を含むUIとCodeMirror editorについて、device間の見た目、可読性、初期load性能を両立するfont delivery方針を検討します。
この文書は方針決定のためのresearchであり、実装変更は含みません。

## Outcome

現段階では、UIとCodeMirrorの両方で**downloadを必要としないsystem font stackを採用する**ことを推奨します。

- UI: `system-ui, sans-serif`
- CodeMirror: `ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`
- Web fontは導入しない
- 端末間で完全に同じ字形にすることより、即時表示、OSとの親和性、日本語glyphの確実なfallbackを優先する
- Brandとして固有の書体が必要になった段階で、remote serviceではなくself-hosted WOFF2を実測して再検討する

これは永久的な決定ではありません。
公開後の利用環境とbrand要件が具体化した時点で再評価します。

## 現状

`src/style.css`のUI stackは先頭に`Inter`を指定していますが、repositoryにはfont file、`@font-face`、remote stylesheetのいずれもありません。
したがって、端末にInterがinstalledでない限り、次のfontへfallbackします。

```css
font-family:
  Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
  sans-serif;
```

CodeMirrorは次のlocal monospace stackを使っています。

```css
font-family:
  "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
```

現在も実質的にはsystem/local font中心ですが、UIは「Interを配信して統一する」という意図にも「system fontを使う」という意図にも読めます。
実装Issueでは、先頭の未配信Interを取り除き、方針をCSSに明示するのが自然です。

## UI fontの比較

| Option | 初期表示・通信 | Device間の統一 | 日本語 | 運用負荷 | 判断 |
| --- | --- | --- | --- | --- | --- |
| System font stack | download不要で最速 | 字形はOSごとに変わる | OSが調整済みのfontを選ぶ | 小さい | 推奨 |
| Self-hosted web font | font fileのdownloadが必要 | 対応glyphの範囲で統一できる | CJKはglyph数が多く最適化が難しい | subset、cache、license管理が必要 | Brand要件が生じたら再検討 |
| Remote web font | 第三者originへの接続とdownloadが必要 | 対応glyphの範囲で統一できる | Providerのsubsetに依存 | Provider、privacy、障害、CSPへの依存が増える | 現段階では非推奨 |

### System font stack

`system-ui`はplatformの既定UI fontを選びます。
font fileを取得しないため、font request、FOIT、font swap由来のlayout shiftがありません。
AppleのTypography guidanceも、custom faceに明確な理由がなければsystem fontを優先し、typeface数を抑えることを勧めています。

一方、macOS、Windows、Linux、Androidで字形やmetricsは同一になりません。
これは欠陥ではなく、各platformで慣れた読み味と日本語fallbackを得るためのtrade-offです。
このEditorは短いUI labelが中心なので、MDNが指摘する`system-ui`の長文組版上の制約も影響しにくいと判断します。

推奨候補は単純なgeneric familyです。

```css
:root {
  font-family: system-ui, sans-serif;
}
```

`-apple-system`や`BlinkMacSystemFont`を併記するlegacy stackも機能しますが、modern browserを対象にする限り、まず`system-ui`を基準にする方が意図が明確です。
最終項には必ずgeneric familyを残します。

### Self-hosted web font

同じfont fileを配信すれば、対応するglyphについてdevice間の統一度を上げられます。
第三者originへのconnectionを避け、cache policyも管理できます。

ただし、日本語fontはLatin fontよりglyph数が大幅に多く、subset設計が難しくなります。
さらに、weightごとのfile、license、cache header、fallback metrics、`font-display`を管理する必要があります。
現時点では、得られるbrand統一よりimplementation・payload costの方が大きいと判断します。

将来採用する場合は次を最低条件とします。

- WOFF2だけを配信する
- 使用weightをRegular、MediumまたはSemibold程度に限定する
- Licenseがself-hostとsubsetを許可していることを確認する
- 日本語とLatinのsubsetを実際のcontentで検証する
- `font-display: optional`を第一候補にし、初回表示のlayout shiftを避ける
- `swap`を使う場合はfallback metricsとCLSを実測する
- Criticalであることを確認できたfontだけをpreloadする

### Remote web font

運用開始は簡単ですが、第三者originへのDNS、connection、TLS setupが加わり、offline・network制限・Provider障害の影響を受けます。
CSPの許可先も増えます。
ユーザーがMermaid codeを貼り付けてすぐ結果を見るtoolでは、装飾fontのためにresponse latencyと外部依存を増やす優先度は低いと判断します。

Remoteとself-hostの性能差は配信基盤によって変わるため、将来の比較では推測ではなく同じfont・同じsubsetをcold cacheで実測します。

## CodeMirror monospaceの比較

Editorではdevice間の字形統一より、columnの把握、記号の識別、日本語とLatinの混在、入力開始までのlatencyを優先します。

| Option | 利点 | 問題 | 判断 |
| --- | --- | --- | --- |
| Local monospace stack | download不要、platformに馴染む | device間で字形が異なる | 推奨 |
| Self-hosted programming font | 記号とLatinの字形を統一 | 日本語glyphは別fontへfallbackしやすく、metrics差が残る | 特別な識別問題が見つかった場合のみ |
| Remote programming font | 導入が容易 | 外部接続、swap、offline時fallback | 非推奨 |

推奨候補は`ui-monospace`を先頭に置き、未対応時の既知local fontとgeneric familyへfallbackするstackです。

```css
.editor-shell .cm-scroller {
  font-family:
    ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", Menlo,
    monospace;
}
```

CSSのfont selectionは文字単位で行われるため、Latin用fontが日本語glyphを持たなければ後続fontが使われます。
したがって「Latin programming fontを配信すれば日本語を含むEditor全体が完全に同じ見た目になる」とは限りません。

また、日本語の全角文字がLatin monospaceの厳密な2倍幅になることを、すべてのOS・fallback組合せで前提にしません。
Mermaid sourceの意味理解には、ligatureやdecorativeなglyphより、`-`, `>`, `[`, `]`, `{`, `}`, `"`, `'`, `0`, `O`, `1`, `l`の識別しやすさを優先します。
Font ligatureは初期段階では有効化しません。

## 可読性の受け入れ基準

UIとEditorを次の文字列で確認します。

```text
ここにペースト Mermaidを書く できあがった図
flowchart LR
  Start["開始"] --> Decision{"入力は正しい？"}
  Decision -- Yes --> Save["保存する"]
  Decision -- No --> Retry["再入力"]
  ID_01 --> O0Il1
```

- 日本語、Latin、数字、記号のbaselineが不自然にずれない
- `0/O`、`1/l/I`、引用符、bracket、arrowを区別できる
- 100%、125%、200% zoomでlabelがclip・overlapしない
- macOS Safari、Windows Chrome、Linux ChromeまたはFirefoxで意味を読み取れる
- Fontが異なってもsplitter、toolbar、status textのlayoutが破綻しない
- 小さいUI textではLight weightを避け、Regular以上を保つ
- OSのfont smoothing差をCSSで無理に統一しない

## 再現可能なperformance確認

候補を比較する場合は、同一browser・同一buildについてsystem font版とweb font版を測定します。

1. Production buildを起動する。

   ```bash
   pnpm build
   pnpm preview --port 5176
   ```

2. Chrome DevToolsのNetworkで`Disable cache`を有効にし、`Fast 3G`と`No throttling`をそれぞれ3回測る。
3. Networkを`Font`でfilterし、request数、transfer size、connection setupを記録する。
4. Performance panelまたはLighthouseでFCP、LCP、CLSを記録し、medianを比較する。
5. Slow networkでUI textが一時的に消えないこと、late swapでpaneやbuttonが動かないことをscreen recordingで確認する。
6. Offline reloadで、UIとEditorがfallback fontにより直ちに操作可能であることを確認する。
7. Consoleで実際に選択可能なfontを補助確認する。

   ```js
   document.fonts.check('16px system-ui')
   document.fonts.check('16px ui-monospace')
   document.fonts.check('16px "Inter"')
   ```

`FontFaceSet.check()`は指定fontが実際に各glyphへ使われたことまでは証明しません。
最終確認にはDevToolsのRendered Fontsと目視を併用します。

System font案のperformance baselineは次です。

- Page load時のfont network request: `0`
- Font起因のinvisible text: `0`
- Font swap起因のCLS: `0`
- Offline時もUIとEditorのtextが表示される

## Decision record

Status: Accepted

採用:

- UIはsystem font
- CodeMirrorはsystem/local monospace
- Deviceごとの字形差を許容する
- Typographyの統一感はfont fileではなく、size、weight、line-height、tracking、spacingのdesign tokenで作る

現段階で不採用:

- 日本語web fontの一括配信
- Google Fontsなどremote Providerへのruntime依存
- Code Editor用font ligature
- Font fileをbase64でCSSへ埋め込む

再検討のtrigger:

- User testで特定OSの日本語または記号の識別問題が再現する
- Brand guidelineが固有fontを要求する
- Screenshotやpresentationでpixel-levelの字形統一が必要になる
- 実利用環境のperformance dataからweb font追加のcostを許容できる

## Sources

- [Apple Human Interface Guidelines: Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
  - System fontの優先、可読性、weight、typeface数、optical sizingの指針。
- [MDN: `font-family`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-family)
  - Generic family、文字単位のfallback、`system-ui`と`ui-monospace`の定義。
- [W3C: CSS Fonts Module Level 4](https://www.w3.org/TR/css-fonts-4/#generic-font-families)
  - Generic font familyとfont matchingの標準仕様。
- [web.dev: Best practices for fonts](https://web.dev/articles/font-best-practices)
  - Self-hostとthird-partyの比較、CJK subsetting、WOFF2、`font-display`、測定方法。
- [web.dev: Optimize web fonts](https://web.dev/learn/performance/optimize-web-fonts)
  - Font discovery、preload、cross-origin cost、WOFF2、rendering behavior。
- [MDN: `font-display`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face/font-display)
  - `block`、`swap`、`fallback`、`optional`のbrowser behavior。
