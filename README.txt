訪問看護AI カイポケ連携サーバー v0.3（試作）

目的:
Mac/Windows/iPadなど利用端末にNode.jsやPlaywrightを入れず、サーバー側でカイポケのCSV取得を行うための試作版です。

必須環境変数:
BRIDGE_SECRET=十分長いランダム文字列
KAIPOKE_LOGIN_ID=カイポケのログインID
KAIPOKE_PASSWORD=カイポケのパスワード
PROFILE_DIR=/data/kaipoke-profile

任意:
KAIPOKE_EXPORT_URL=看護記録書Ⅱ 出力条件画面の固定/利用可能なURLがある場合のみ設定
PORT=38765

注意:
・カイポケ認証情報はWordPressではなく、ホスティングサービスのSecret/Environment Variablesとして設定してください。
・永続ボリュームを /data に割り当てるとブラウザセッションを保持できます。
・追加認証、CAPTCHA、画面変更がある場合は自動ログイン処理の調整が必要です。
・本番運用/他社提供前に、カイポケの利用規約・連携可否、個人情報/医療情報の保管方針を確認してください。
・この版は1事業所での技術検証用です。複数事業所提供にはテナント分離、暗号化、監査ログ、権限管理が別途必要です。
