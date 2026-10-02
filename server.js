import express from 'express';
import { chromium } from 'playwright';
import fs from 'fs';

/* =========================================================
   Environment
========================================================= */

const PORT = Number(process.env.PORT || 38765);

const SECRET = process.env.BRIDGE_SECRET || '';

const KP_CORPORATE_ID =
  process.env.KAIPOKE_CORPORATE_ID || '';

const KP_USER_ID =
  process.env.KAIPOKE_USER_ID || '';

const KP_PASS =
  process.env.KAIPOKE_PASSWORD || '';

const PROFILE =
  process.env.PROFILE_DIR || '/data/kaipoke-profile';

const EXPORT_URL =
  process.env.KAIPOKE_EXPORT_URL || '';

const LOGIN_URL =
  'https://r.kaipoke.biz/kaipokebiz/login/COM020102.do';

if (!SECRET) {
  throw new Error('BRIDGE_SECRET is required');
}


/* =========================================================
   Express
========================================================= */

const app = express();

app.use(
  express.json({
    limit: '1mb'
  })
);


/*
 * WordPress → Railway の認証
 */

app.use((req, res, next) => {

  if (
    req.get('X-Bridge-Secret') !== SECRET
  ) {

    return res
      .status(401)
      .json({
        error: 'Unauthorized'
      });
  }

  next();
});


/* =========================================================
   Browser
========================================================= */

let context = null;


async function ctx() {

  if (!context) {

    fs.mkdirSync(
      PROFILE,
      {
        recursive: true
      }
    );

    context =
      await chromium.launchPersistentContext(
        PROFILE,
        {
          headless: true,

          acceptDownloads: true,

          args: [
            '--no-sandbox',
            '--disable-dev-shm-usage'
          ]
        }
      );
  }

  return context;
}


async function getPage() {

  const c = await ctx();

  const pages = c.pages();

  if (pages.length) {
    return pages[0];
  }

  return await c.newPage();
}


/* =========================================================
   Kaipoke helpers
========================================================= */

function isKaipoke(url = '') {

  try {

    const hostname =
      new URL(url).hostname;

    return (
      hostname === 'kaipoke.biz' ||
      hostname.endsWith('.kaipoke.biz')
    );

  } catch {

    return false;
  }
}


async function bodyText(p) {

  return await p
    .locator('body')
    .innerText()
    .catch(() => '');
}


/*
 * ログイン済みか判定
 */

async function loggedIn(p) {

  if (!isKaipoke(p.url())) {
    return false;
  }

  const text =
    await bodyText(p);

  /*
   * ログアウト表示があれば
   * ログイン済みと判断
   */

  if (
    /ログアウト/.test(text)
  ) {
    return true;
  }


  /*
   * 法人ID・ユーザーID・パスワードが
   * 同時に表示されている場合はログイン画面
   */

  const loginPage =
    /法人ID/.test(text) &&
    /ユーザーID/.test(text) &&
    /パスワード/.test(text);

  if (loginPage) {
    return false;
  }


  /*
   * ログインページURLなら未ログイン
   */

  if (
    /COM020102\.do/i.test(
      p.url()
    )
  ) {
    return false;
  }


  return true;
}


/* =========================================================
   Diagnostic
========================================================= */

/*
 * ログイン失敗時の診断メッセージ
 *
 * ID・パスワードそのものは
 * 出力しない。
 */

async function loginDiagnostic(p) {

  const currentUrl =
    p.url();

  const title =
    await p
      .title()
      .catch(() => '');

  const text =
    await bodyText(p);


  /*
   * カイポケ画面から
   * エラーに関係しそうな行だけ抽出
   */

  const lines =
    text
      .split('\n')

      .map(v =>
        v.trim()
      )

      .filter(Boolean)

      .filter(v =>
        /エラー|誤り|正しく|認証|ログイン|一致|無効|ロック|確認|失敗|入力してください|お知らせ/.test(v)
      )

      /*
       * 万一入力値が画面に表示されていた場合に備えて
       * 認証情報と一致する文字列は除外
       */
      .filter(v =>
        v !== KP_CORPORATE_ID &&
        v !== KP_USER_ID &&
        v !== KP_PASS
      )

      .slice(0, 10);


  return [
    'カイポケ自動ログイン診断',
    `URL: ${currentUrl}`,
    `TITLE: ${title}`,
    lines.length
      ? `MESSAGE: ${lines.join(' / ')}`
      : 'MESSAGE: ログイン失敗理由を画面から取得できませんでした。'
  ].join('\n');
}


/* =========================================================
   Login input
========================================================= */

async function getVisibleTextInputs(p) {

  return p.locator(
    'input[type="text"]:visible'
  );
}


/*
 * ログインボタンを探してクリック
 */

async function clickLoginButton(p) {

  const selectors = [

    'button:has-text("ログイン")',

    'input[type="submit"][value*="ログイン"]',

    'input[type="button"][value*="ログイン"]',

    'input[type="image"]',

    'input[type="submit"]',

    'button[type="submit"]',

    'a:has-text("ログイン")'
  ];


  for (
    const selector of selectors
  ) {

    const candidate =
      p.locator(
        selector
      ).first();


    const count =
      await candidate
        .count()
        .catch(() => 0);


    if (!count) {
      continue;
    }


    const visible =
      await candidate
        .isVisible()
        .catch(() => false);


    if (!visible) {
      continue;
    }


    await candidate.click();

    return true;
  }


  return false;
}


/* =========================================================
   Kaipoke Login
========================================================= */

async function autoLogin(p) {

  /*
   * カイポケ以外のページなら
   * ログインページへ移動
   */

  if (!isKaipoke(p.url())) {

    await p.goto(
      LOGIN_URL,
      {
        waitUntil:
          'domcontentloaded',

        timeout:
          60000
      }
    );
  }


  /*
   * すでにログイン済みなら終了
   */

  if (
    await loggedIn(p)
  ) {

    return true;
  }


  /*
   * 念のためログイン画面へ
   */

  if (
    !/COM020102\.do/i.test(
      p.url()
    )
  ) {

    await p.goto(
      LOGIN_URL,
      {
        waitUntil:
          'domcontentloaded',

        timeout:
          60000
      }
    );
  }


  /*
   * Railway Variables確認
   */

  if (
    !KP_CORPORATE_ID ||
    !KP_USER_ID ||
    !KP_PASS
  ) {

    throw new Error(
      'Railwayにカイポケの法人ID・ユーザーID・パスワードが設定されていません。'
    );
  }


  /*
   * 法人ID・ユーザーID
   */

  const textInputs =
    await getVisibleTextInputs(p);

  const textCount =
    await textInputs.count();


  if (textCount < 2) {

    throw new Error(
      [
        'カイポケの法人ID・ユーザーID入力欄を検出できませんでした。',
        `検出したテキスト入力欄: ${textCount}`
      ].join('\n')
    );
  }


  /*
   * 1番目 = 法人ID
   * 2番目 = ユーザーID
   */

  await textInputs
    .nth(0)
    .fill(
      KP_CORPORATE_ID
    );


  await textInputs
    .nth(1)
    .fill(
      KP_USER_ID
    );


  /*
   * パスワード
   */

  const passwordInput =
    p.locator(
      'input[type="password"]:visible'
    ).first();


  const passwordCount =
    await passwordInput.count();


  if (!passwordCount) {

    throw new Error(
      'カイポケのパスワード入力欄を検出できませんでした。'
    );
  }


  await passwordInput.fill(
    KP_PASS
  );


  /*
   * ログインボタン
   */

  const clicked =
    await clickLoginButton(p);


  if (!clicked) {

    throw new Error(
      'カイポケのログインボタンを検出できませんでした。'
    );
  }


  /*
   * 画面遷移を待つ
   */

  await p
    .waitForLoadState(
      'domcontentloaded',
      {
        timeout: 60000
      }
    )
    .catch(() => {});


  await p.waitForTimeout(
    2500
  );


  /*
   * ログイン成功確認
   */

  if (
    !(await loggedIn(p))
  ) {

    const diagnostic =
      await loginDiagnostic(p);

    throw new Error(
      diagnostic
    );
  }


  return true;
}


/* =========================================================
   Date
========================================================= */

function era(date) {

  const d =
    new Date(
      `${date}T00:00:00`
    );


  if (
    Number.isNaN(
      d.getTime()
    )
  ) {

    throw new Error(
      '日付を解析できませんでした。'
    );
  }


  return {

    era:
      '令和',

    year:
      d.getFullYear() - 2018,

    month:
      d.getMonth() + 1,

    day:
      d.getDate()
  };
}


/* =========================================================
   Select helper
========================================================= */

async function choose(
  select,
  candidates
) {

  for (
    const value of candidates
  ) {

    try {

      await select.selectOption({
        label: String(value)
      });

      return true;

    } catch {}


    try {

      await select.selectOption(
        String(value)
      );

      return true;

    } catch {}
  }


  return false;
}


/* =========================================================
   Export date settings
========================================================= */

async function setDates(
  p,
  from,
  to
) {

  const selects =
    p.locator(
      'select:visible'
    );


  const count =
    await selects.count();


  if (count < 6) {

    throw new Error(
      `訪問日の選択欄を検出できませんでした。select数: ${count}`
    );
  }


  const startDate =
    era(from);

  const endDate =
    era(to);


  const meta = [];


  for (
    let i = 0;
    i < count;
    i++
  ) {

    const options =
      await selects
        .nth(i)
        .locator('option')
        .allTextContents();


    meta.push(
      options.join('|')
    );
  }


  let start =
    meta.findIndex(
      value =>
        value.includes(
          '令和'
        )
    );


  if (start < 0) {
    start = 0;
  }


  const hasEra =
    meta[start] &&
    meta[start].includes(
      '令和'
    );


  const values =
    hasEra

      ? [
          startDate.era,
          startDate.year,
          startDate.month,
          startDate.day,

          endDate.era,
          endDate.year,
          endDate.month,
          endDate.day
        ]

      : [
          startDate.year,
          startDate.month,
          startDate.day,

          endDate.year,
          endDate.month,
          endDate.day
        ];


  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    const value =
      values[i];


    const ok =
      await choose(
        selects.nth(
          start + i
        ),
        [
          value,
          `${value}年`,
          `${value}月`,
          `${value}日`,
          String(value)
            .padStart(
              2,
              '0'
            )
        ]
      );


    if (!ok) {

      throw new Error(
        `日付欄(${i + 1})を設定できませんでした。`
      );
    }
  }
}


/* =========================================================
   Open export screen
========================================================= */

async function openExport(p) {

  /*
   * Railwayに固定URLを設定している場合
   */

  if (EXPORT_URL) {

    await p.goto(
      EXPORT_URL,
      {
        waitUntil:
          'domcontentloaded',

        timeout:
          60000
      }
    );


    return;
  }


  /*
   * すでに出力画面の場合
   */

  const currentText =
    await bodyText(p);


  if (
    /careRecordDocument2Export/i
      .test(p.url()) ||

    currentText.includes(
      '看護記録書Ⅱ'
    )
  ) {

    return;
  }


  /*
   * メニュー文字から順番に探索
   */

  const menuLabels = [
    '訪問看護',
    '各種帳票',
    '看護記録書Ⅱ'
  ];


  for (
    const label of menuLabels
  ) {

    const item =
      p.getByText(
        label,
        {
          exact: false
        }
      ).first();


    const exists =
      await item
        .count()
        .catch(() => 0);


    if (!exists) {
      continue;
    }


    const visible =
      await item
        .isVisible()
        .catch(() => false);


    if (!visible) {
      continue;
    }


    await item.click();


    await p
      .waitForLoadState(
        'domcontentloaded',
        {
          timeout:
            30000
        }
      )
      .catch(() => {});


    await p.waitForTimeout(
      700
    );
  }


  /*
   * 最終確認
   */

  const finalText =
    await bodyText(p);


  if (
    !/careRecordDocument2Export/i
      .test(p.url()) &&

    !finalText.includes(
      '看護記録書Ⅱ'
    )
  ) {

    throw new Error(
      '看護記録書Ⅱの出力画面へ自動移動できませんでした。'
    );
  }
}


/* =========================================================
   CSV button
========================================================= */

async function findCsvButton(p) {

  const selectors = [

    'button:has-text("CSV出力")',

    'input[value*="CSV出力"]',

    'input[type="submit"][value*="CSV"]',

    'a:has-text("CSV出力")'
  ];


  for (
    const selector of selectors
  ) {

    const candidate =
      p.locator(
        selector
      ).last();


    const count =
      await candidate
        .count()
        .catch(() => 0);


    if (!count) {
      continue;
    }


    const visible =
      await candidate
        .isVisible()
        .catch(() => false);


    if (visible) {
      return candidate;
    }
  }


  return null;
}


/* =========================================================
   API : health
========================================================= */

app.get(
  '/health',
  (req, res) => {

    res.json({
      ok: true
    });
  }
);


/* =========================================================
   API : status
========================================================= */

app.get(
  '/status',
  async (req, res) => {

    try {

      const p =
        await getPage();


      res.json({

        running:
          true,

        loggedIn:
          await loggedIn(p)

      });

    } catch (error) {

      res
        .status(500)
        .json({
          error:
            error.message
        });
    }
  }
);


/* =========================================================
   API : connect
========================================================= */

app.post(
  '/connect',
  async (req, res) => {

    try {

      const p =
        await getPage();


      await autoLogin(p);


      res.json({

        ok:
          true,

        loggedIn:
          true,

        message:
          'カイポケへ接続しました。'
      });


    } catch (error) {

      res
        .status(500)
        .json({
          error:
            error.message ||
            'カイポケへの接続に失敗しました。'
        });
    }
  }
);


/* =========================================================
   API : export
========================================================= */

app.post(
  '/export',
  async (req, res) => {

    try {

      const {
        from,
        to
      } =
        req.body || {};


      /*
       * 日付チェック
       */

      if (
        !/^\d{4}-\d{2}-\d{2}$/
          .test(from || '') ||

        !/^\d{4}-\d{2}-\d{2}$/
          .test(to || '')
      ) {

        return res
          .status(400)
          .json({
            error:
              '日付が不正です。'
          });
      }


      if (
        new Date(from) >
        new Date(to)
      ) {

        return res
          .status(400)
          .json({
            error:
              '開始日は終了日以前にしてください。'
          });
      }


      const p =
        await getPage();


      /*
       * カイポケログイン
       */

      await autoLogin(p);


      /*
       * 看護記録書Ⅱ画面
       */

      await openExport(p);


      /*
       * 日付設定
       */

      await setDates(
        p,
        from,
        to
      );


      /*
       * CSVボタン
       */

      const csvButton =
        await findCsvButton(p);


      if (!csvButton) {

        throw new Error(
          'CSV出力ボタンを検出できませんでした。'
        );
      }


      /*
       * ダウンロード待機
       */

      const downloadPromise =
        p.waitForEvent(
          'download',
          {
            timeout:
              60000
          }
        );


      await csvButton.click();


      const download =
        await downloadPromise;


      const tmp =
        await download.path();


      if (!tmp) {

        throw new Error(
          'CSVファイルを取得できませんでした。'
        );
      }


      const buffer =
        fs.readFileSync(
          tmp
        );


      /*
       * WordPressへCSVを返す
       */

      res.json({

        ok:
          true,

        filename:
          download.suggestedFilename() ||
          `看護記録書Ⅱ_${from}-${to}.csv`,

        csvBase64:
          buffer.toString(
            'base64'
          )
      });


    } catch (error) {

      res
        .status(500)
        .json({

          error:
            error.message ||
            'CSV取得に失敗しました。'
        });
    }
  }
);


/* =========================================================
   Start
========================================================= */

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `Kaipoke bridge server listening on ${PORT}`
    );
  }
);
