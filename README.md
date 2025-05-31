## MIDI の作成

### ダウンロード

yt-dlp でゲームの対象にしたいピアノ練習動画をダウンロード

```bash
yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]" "https://www.youtube.com/watch?v=xxx" --cookies-from-browser edge
```

上記は cookie の取得に edge ブラウザを利用している前提だが、他のブラウザで YouTube のログインをしている場合は適宜変更。

ここで直接 mp3 をダウンロードしてもよい。

mac の場合は、QuickTime で Audio のみエクスポートして m4a ファイルを得る。

### MIDI データを作成

https://piano-scribe.glitch.me/

上記サイトで変換し MIDI をダウンロードする。あまり長い動画にすると時間がかかる。5 分以内の動画を推奨。

以下のサイトで MIDI がうまく作れているかを確認できる。

https://signal.vercel.app/edit

