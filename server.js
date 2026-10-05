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
 * WordPress → Railway 認証
 */
app.use((req, res, next) => {

  const receivedSecret =
    req.get('X-Bridge-Secret');

  if (receivedSecret !== SECRET) {

    return res
      .status(401)
      .json({
        error: 'Unauthorized'
      });
  }

  next();
});


/* =========================================================
   Playwright
========================================================= */

let browserContext = null;


async function getContext() {

  if (!browserContext) {

    fs.mkdirSync(
      PROFILE,
      {
        recursive: true
      }
    );

    console.log(
      'Starting Chromium...'
    );

    browserContext =
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

    console.log(
      'Chromium started'
    );
  }

  return browserContext;
}


async function getPage() {

  const context =
    await getContext();

  const pages =
    context.pages();

  if (pages.length > 0) {
    return pages[0];
  }

  return await context.newPage();
}


/* =========================================================
   Helpers
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


async function getBodyText(p) {

  try {

    return await p
      .locator('body')
      .innerText();

  } catch {

    return '';
  }
}


async function getSafeTitle(p) {

  try {

    return await p.title();

  } catch {

    return '';
  }
}


/* =========================================================
   Login state
========================================================= */

async function isLoggedIn(p) {

  if (!isKaipoke(p.url())) {
    return false;
  }

  const text =
    await getBodyText(p);

  /*
   * ログイン画面に3項目が存在する場合は未ログイン
   */
  const looksLikeLoginPage =
    text.includes('法人ID') &&
    text.includes('ユーザーID') &&
    text.includes('パスワード');

  if (looksLikeLoginPage) {
    return false;
  }

  /*
   * ログアウト表示があればログイン済み
   */
  if (text.includes('ログアウト')) {
    return true;
  }

  /*
   * Kaipoke内でログイン画面ではない場合
   */
  return true;
}


/* =========================================================
   Kaipoke Login
========================================================= */

async function autoLogin(p) {

  console.log(
    '=== KAIPOKE LOGIN START ==='
  );


  /*
   * ログイン済みならそのまま利用
   */
  if (await isLoggedIn(p)) {

    console.log(
      'Already logged in'
    );

    return true;
  }


  /*
   * ログインページへ移動
   */
  console.log(
    'Opening login page...'
  );

  await p.goto(
    LOGIN_URL,
    {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    }
  );


  await p.waitForTimeout(1000);


  console.log(
    'LOGIN URL:',
    p.url()
  );

  console.log(
    'LOGIN TITLE:',
    await getSafeTitle(p)
  );


  /*
   * 既存セッションでログイン済みになった場合
   */
  if (await isLoggedIn(p)) {

    console.log(
      'Logged in by existing session'
    );

    return true;
  }


  /*
   * Railway環境変数チェック
   */
  if (
    !KP_CORPORATE_ID ||
    !KP_USER_ID ||
    !KP_PASS
  ) {

    throw new Error(
      'Railwayに法人ID・ユーザーID・パスワードが設定されていません。'
    );
  }


  /*
   * テキスト入力欄を取得
   */
  const textInputs =
    p.locator(
      'input[type="text"]:visible'
    );

  const textCount =
    await textInputs.count();


  console.log(
    'Visible text inputs:',
    textCount
  );


  if (textCount < 2) {

    throw new Error(
      `法人ID・ユーザーID入力欄を検出できませんでした。検出数=${textCount}`
    );
  }


  /*
   * 1番目：法人ID
   * 2番目：ユーザーID
   */
  await textInputs
    .nth(0)
    .fill(KP_CORPORATE_ID);

  await textInputs
    .nth(1)
    .fill(KP_USER_ID);


  console.log(
    'Corporate ID and User ID entered'
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


  console.log(
    'Visible password inputs:',
    passwordCount
  );


  if (passwordCount < 1) {

    throw new Error(
      'パスワード入力欄を検出できませんでした。'
    );
  }


  await passwordInput.fill(
    KP_PASS
  );


  console.log(
    'Password entered'
  );


  /*
   * ログインボタン検出
   */
  const loginSelectors = [

    'button:has-text("ログイン")',

    'input[type="submit"][value*="ログイン"]',

    'input[type="image"]',

    'input[type="submit"]',

    'a:has-text("ログイン")'

  ];


  let loginClicked = false;


  for (
    const selector
    of loginSelectors
  ) {

    const candidate =
      p.locator(
        selector
      ).first();


    const count =
      await candidate.count();


    if (count < 1) {
      continue;
    }


    const visible =
      await candidate
        .isVisible()
        .catch(() => false);


    if (!visible) {
      continue;
    }


    console.log(
      'Login button found:',
      selector
    );


    await candidate.click();


    loginClicked = true;

    break;
  }


  if (!loginClicked) {

    throw new Error(
      'カイポケのログインボタンを検出できませんでした。'
    );
  }


  /*
   * ログイン後の遷移待ち
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
    2000
  );


  console.log(
    'AFTER LOGIN URL:',
    p.url()
  );

  console.log(
    'AFTER LOGIN TITLE:',
    await getSafeTitle(p)
  );


  /*
   * ログイン判定
   */
  if (!(await isLoggedIn(p))) {

    const body =
      await getBodyText(p);

    /*
     * 認証情報はログに出さない
     */
    const safePreview =
      body
        .replace(
          KP_CORPORATE_ID,
          '[CORPORATE_ID]'
        )
        .replace(
          KP_USER_ID,
          '[USER_ID]'
        )
        .replace(
          KP_PASS,
          '[PASSWORD]'
        )
        .slice(0, 500);


    console.error(
      'LOGIN PAGE MESSAGE:',
      safePreview
    );


    throw new Error(
      'カイポケへのログインに失敗しました。ログイン画面に留まっています。'
    );
  }


  console.log(
    '=== KAIPOKE LOGIN SUCCESS ==='
  );


  return true;
}


/* =========================================================
   Japanese era
========================================================= */

function toJapaneseEra(
  dateString
) {

  const d =
    new Date(
      `${dateString}T00:00:00`
    );


  if (
    Number.isNaN(
      d.getTime()
    )
  ) {

    throw new Error(
      '日付の変換に失敗しました。'
    );
  }


  return {

    era: '令和',

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

async function selectCandidate(
  select,
  values
) {

  for (
    const value
    of values
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
   Set export dates
========================================================= */

async function setExportDates(
  p,
  from,
  to
) {

  console.log(
    'Setting export dates:',
    from,
    to
  );


  const selects =
    p.locator(
      'select:visible'
    );


  const count =
    await selects.count();


  console.log(
    'Visible selects:',
    count
  );


  if (count < 6) {

    throw new Error(
      `訪問日の選択欄を検出できません。select数=${count}`
    );
  }


  const startDate =
    toJapaneseEra(from);

  const endDate =
    toJapaneseEra(to);


  const optionTexts = [];


  for (
    let i = 0;
    i < count;
    i++
  ) {

    const text =
      (
        await selects
          .nth(i)
          .locator('option')
          .allTextContents()
      ).join('|');


    optionTexts.push(
      text
    );
  }


  let startIndex =
    optionTexts.findIndex(
      text =>
        text.includes('令和')
    );


  if (startIndex < 0) {
    startIndex = 0;
  }


  const hasEra =
    optionTexts[
      startIndex
    ]?.includes('令和');


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


    const target =
      selects.nth(
        startIndex + i
      );


    const success =
      await selectCandidate(
        target,
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


    if (!success) {

      throw new Error(
        `日付欄${i + 1}を設定できませんでした。`
      );
    }
  }


  console.log(
    'Export dates configured'
  );
}


/* =========================================================
   Open 看護記録書Ⅱ export page
========================================================= */

/* =========================================================
   Open 看護記録書Ⅱ export page
========================================================= */

async function openExportPage(p) {

  console.log('=== OPEN EXPORT PAGE START ===');
  console.log('START URL:', p.url());

  /*
   * すでに看護記録書Ⅱの出力画面なら終了
   */
  if (
    /\/bizhnc\/careRecordDocument2Export/i.test(p.url())
  ) {
    console.log('Already on 看護記録書Ⅱ export page');
    return;
  }


  /*
   * 念のためログイン状態を確認
   */
  if (isLoginPage(p.url())) {
    console.log('Login page detected. Logging in...');

    await autoLogin(p);

    await p.waitForTimeout(1000);
  }


  /*
   * EXPORT_URL が設定されている場合
   *
   * ※ conversationContext や内部ID入りのURLを
   *   Railwayへ固定設定することは推奨しません。
   */
  if (EXPORT_URL) {

    console.log('Using KAIPOKE_EXPORT_URL');

    await p.goto(
      EXPORT_URL,
      {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      }
    );

    await p.waitForTimeout(1000);

    console.log('AFTER EXPORT_URL:', p.url());

    if (
      /\/bizhnc\/careRecordDocument2Export/i.test(p.url())
    ) {
      console.log('=== OPEN EXPORT PAGE SUCCESS ===');
      return;
    }
  }


  /*
   * 上部メニュー「各種情報出力」を探す
   */
  console.log('Searching 各種情報出力 menu...');

  const infoMenu =
    p.getByText(
      '各種情報出力',
      {
        exact: false
      }
    ).first();


  if (
    await infoMenu.count() &&
    await infoMenu
      .isVisible()
      .catch(() => false)
  ) {

    console.log('各種情報出力 menu found');

    await infoMenu.click()
      .catch(() => {});

    await p.waitForTimeout(700);
  }


  /*
   * 「出力対象選択」を探す
   */
  console.log('Searching 出力対象選択...');

  const targetMenu =
    p.getByText(
      '出力対象選択',
      {
        exact: false
      }
    ).first();


  if (
    await targetMenu.count() &&
    await targetMenu
      .isVisible()
      .catch(() => false)
  ) {

    console.log('Clicking 出力対象選択');

    await targetMenu.click();

    await p
      .waitForLoadState(
        'domcontentloaded',
        {
          timeout: 30000
        }
      )
      .catch(() => {});

    await p.waitForTimeout(1000);
  }


  /*
   * ここですでに対象画面へ来ている可能性
   */
  if (
    /\/bizhnc\/careRecordDocument2Export/i.test(p.url())
  ) {
    console.log('=== OPEN EXPORT PAGE SUCCESS ===');
    return;
  }


  /*
   * 「看護記録書Ⅱ」を探す
   */
  console.log('Searching 看護記録書Ⅱ...');

  const record2 =
    p.getByText(
      '看護記録書Ⅱ',
      {
        exact: false
      }
    ).first();


  if (
    await record2.count() &&
    await record2
      .isVisible()
      .catch(() => false)
  ) {

    console.log('Clicking 看護記録書Ⅱ');

    await record2.click();

    await p
      .waitForLoadState(
        'domcontentloaded',
        {
          timeout: 30000
        }
      )
      .catch(() => {});

    await p.waitForTimeout(1000);
  }


  /*
   * 最終確認
   */
  const finalURL = p.url();
  const finalText = await getBodyText(p);

  console.log('FINAL URL:', finalURL);
  console.log(
    'FINAL TITLE:',
    await getSafeTitle(p)
  );


  if (
    /\/bizhnc\/careRecordDocument2Export/i.test(finalURL) ||
    (
      finalText.includes('看護記録書Ⅱ') &&
      finalText.includes('出力条件')
    )
  ) {

    console.log('=== OPEN EXPORT PAGE SUCCESS ===');
    return;
  }


  console.error('=== OPEN EXPORT PAGE FAILED ===');

  throw new Error(
    '看護記録書Ⅱの出力画面へ自動移動できませんでした。'
  );
}




/* =========================================================
   Health
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
   Status
========================================================= */

app.get(
  '/status',
  async (req, res) => {

    try {

      const p =
        await getPage();


      res.json({

        running: true,

        loggedIn:
          await isLoggedIn(p),

        currentHost:
          (() => {

            try {

              return new URL(
                p.url()
              ).hostname;

            } catch {

              return '';
            }

          })()

      });


    } catch (e) {

      console.error(
        'STATUS ERROR:',
        e?.message || e
      );


      res
        .status(500)
        .json({

          error:
            e?.message ||
            'Status error'

        });
    }
  }
);


/* =========================================================
   Connect
========================================================= */

app.post(
  '/connect',
  async (req, res) => {

    let p = null;


    try {

      console.log(
        '=== CONNECT START ==='
      );


      p =
        await getPage();


      console.log(
        'BEFORE LOGIN URL:',
        p.url()
      );


      await autoLogin(p);


      console.log(
        'AFTER LOGIN URL:',
        p.url()
      );


      console.log(
        'AFTER LOGIN TITLE:',
        await getSafeTitle(p)
      );


      console.log(
        '=== CONNECT SUCCESS ==='
      );


      res.json({

        ok: true,

        loggedIn: true,

        message:
          'カイポケへ接続しました。'

      });


    } catch (e) {

      const currentUrl =
        p
          ? p.url()
          : '';


      const currentTitle =
        p
          ? await getSafeTitle(p)
          : '';


      console.error(
        '=== CONNECT ERROR ==='
      );

      console.error(
        'URL:',
        currentUrl
      );

      console.error(
        'TITLE:',
        currentTitle
      );

      console.error(
        'ERROR:',
        e?.message || e
      );

      console.error(
        '====================='
      );


      res
        .status(500)
        .json({

          error:
            e?.message ||
            'カイポケ接続に失敗しました。',

          diagnostic: {

            url:
              currentUrl,

            title:
              currentTitle

          }
        });
    }
  }
);


/* =========================================================
   Export
========================================================= */

app.post(
  '/export',
  async (req, res) => {

    let p = null;


    try {

      const {
        from,
        to
      } =
        req.body || {};


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


      console.log(
        '=== EXPORT START ==='
      );


      p =
        await getPage();


      await autoLogin(p);


      await openExportPage(p);


      await setExportDates(
        p,
        from,
        to
      );


      /*
       * CSV出力ボタン
       */
      const csvButton =
        p.getByText(
          'CSV出力',
          {
            exact: true
          }
        ).last();


      const buttonCount =
        await csvButton.count();


      if (buttonCount < 1) {

        throw new Error(
          'CSV出力ボタンを検出できませんでした。'
        );
      }


      console.log(
        'CSV button found'
      );


      const downloadPromise =
        p.waitForEvent(
          'download',
          {
            timeout: 60000
          }
        );


      await csvButton.click();


      const download =
        await downloadPromise;


      const temporaryPath =
        await download.path();


      if (!temporaryPath) {

        throw new Error(
          'CSVファイルを取得できませんでした。'
        );
      }


      const buffer =
        fs.readFileSync(
          temporaryPath
        );


      console.log(
        'CSV downloaded:',
        buffer.length,
        'bytes'
      );


      console.log(
        '=== EXPORT SUCCESS ==='
      );


      res.json({

        ok: true,

        filename:
          download
            .suggestedFilename() ||

          `看護記録書Ⅱ_${from}-${to}.csv`,

        csvBase64:
          buffer.toString(
            'base64'
          )

      });


    } catch (e) {

      console.error(
        '=== EXPORT ERROR ==='
      );

      console.error(
        'URL:',
        p
          ? p.url()
          : ''
      );

      console.error(
        'TITLE:',
        p
          ? await getSafeTitle(p)
          : ''
      );

      console.error(
        'ERROR:',
        e?.message || e
      );

      console.error(
        '===================='
      );


      res
        .status(500)
        .json({

          error:
            e?.message ||
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
