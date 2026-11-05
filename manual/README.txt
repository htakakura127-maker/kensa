修正手順の画像の置き場所（アプリの「修正手順」ボタンで表示されます）

元の画像は 点検内容\修正手順 にあり、ここには英数字の名前でコピーしています。
タッチパネルは、各台の型番から機種のシリーズを判定して、シリーズごとの画像を出します。

  シリーズ（判定する型番）               輝度調整                時刻合わせ
  GP4000（PFXGP4…／GP4…）               gp4000-brightness.png   gp4000-clock.png
  GP477R・GP577R（GP477R…／GP577R…）     gp477r-brightness.png   gp477r-clock.png
  GOT2000（GT2…）                        gt2000-brightness.png   gt2000-clock.png
  記録計                                  ―                      recorder-clock.png（未作成）

1つの手順が複数枚になる場合は、2枚目以降を -2.png、-3.png … とする（例：gp4000-clock-2.png）。
JPEG（.jpg）でもよい。新しいシリーズを足すときは index.html の MANUAL_SERIES に1行追加する。

GitHub への置き方
  リポジトリ（kensa）で Add file → Upload files を開き、この manual フォルダごとドラッグする
  （フォルダごと入れると、GitHub 上にも manual フォルダができます）。

注意
  GitHub Pages は公開サイトです。画像はURLを知っていれば誰でも見られます。
  客先の設定値や社外秘の画面が写っている画像は置かないでください。
