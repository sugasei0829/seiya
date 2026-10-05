import express from 'express';
import { chromium } from 'playwright';
import fs from 'fs';

/* =========================================================
   Environment
========================================================= */

const PORT = Number(process.env.PORT || 38765);

const SECRET =
  process.env.BRIDGE_SECRET || '';

const KP_CORPORATE_ID =
  process.env.KAIPOKE_CORPORATE_ID || '';

const KP_USER_ID =
  process.env.KAIPOKE_USER_ID || '';

const KP_PASS =
  process.env.KAIPOKE_PASSWORD || '';

const PROFILE =
  process.env.PROFILE_DIR || '/data/kaipoke-profile';


/*
 * カイポケ ログイン画面
 */
const LOGIN_URL =
  'https://r.kaipoke.biz/kaipokebiz/login/COM020102.do';


/*
 * 「各種情報出力 → 出力対象選択」画面
 *
 * conversationContext は固定しません。
 */
const OUTPUT_SELECTION_URL =
  'https://r.kaipoke.biz/kaipokebiz/business/various_outputs/HNC096201.do';


if (!SECRET) {
  throw new Error(
    'BRIDGE_SECRET is required'
  );
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


function isLoginUrl(url = '') {

  return (
    /\/login\/COM020102\.do/i
      .test(url)
  );
}


function isOutputSelectionUrl(url = '') {

  return (
    /\/business\/various_outputs\/HNC096201\.do/i
      .test(url)
  );
}


function isExportUrl(url = '') {

  return (
    /careRecordDocument2Export/i
      .test(url)
  );
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


async function waitPage(
  p,
  ms = 1200
) {

  await p
    .waitForLoadState(
      'domcontentloaded',
      {
        timeout: 30000
      }
    )
    .catch(() => {});

  await p.waitForTimeout(ms);
}


/* =========================================================
   Login state
========================================================= */

async function isLoggedIn(p) {

  const url =
    p.url();

  if (!isKaipoke(url)) {
    return false;
  }


  if (isLoginUrl(url)) {
    return false;
  }


  const text =
    await getBodyText(p);


  /*
   * ログインフォーム判定
   */
  const looksLikeLoginPage =
    text.includes('法人ID') &&
    text.includes('ユーザーID') &&
    text.includes('パスワード') &&
    text.includes('ログイン');


  if (looksLikeLoginPage) {
    return false;
  }


  /*
   * ログアウト表示があれば
   * 確実にログイン済み
   */
  if (text.includes('ログアウト')) {
    return true;
  }


  /*
   * Kaipoke内でログイン画面以外なら
   * ログイン済みとして扱う
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
   * すでにログイン済み
   */
  if (await isLoggedIn(p)) {

    console.log(
      'Already logged in'
    );

    return true;
  }


  /*
   * 環境変数確認
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


  await p.waitForTimeout(
    1000
  );


  console.log(
    'LOGIN URL:',
    p.url()
  );

  console.log(
    'LOGIN TITLE:',
    await getSafeTitle(p)
  );


  /*
   * 保存セッションで
   * ログイン済みになった場合
   */
  if (await isLoggedIn(p)) {

    console.log(
      'Logged in by existing session'
    );

    return true;
  }


  /*
   * 法人ID・ユーザーID
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


  if (
    await passwordInput.count() < 1
  ) {

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
   * ログインボタン
   */
  const loginSelectors = [

    'button:has-text("ログイン")',

    'input[type="submit"][value*="ログイン"]',

    'input[type="image"]',

    'input[type="submit"]'

  ];


  let loginButton =
    null;


  for (
    const selector
    of loginSelectors
  ) {

    const candidate =
      p.locator(
        selector
      ).first();


    if (
      await candidate.count() < 1
    ) {
      continue;
    }


    const visible =
      await candidate
        .isVisible()
        .catch(
          () => false
        );


    if (!visible) {
      continue;
    }


    loginButton =
      candidate;


    console.log(
      'Login button found:',
      selector
    );


    break;
  }


  if (!loginButton) {

    throw new Error(
      'カイポケのログインボタンを検出できませんでした。'
    );
  }


  /*
   * ログイン実行
   */
  await loginButton.click();


  await waitPage(
    p,
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


  if (!(await isLoggedIn(p))) {

    throw new Error(
      'カイポケへのログインに失敗しました。'
    );
  }


  console.log(
    '=== KAIPOKE LOGIN SUCCESS ==='
  );


  return true;
}


/* =========================================================
   Japanese date
========================================================= */

function toJapaneseEra(
  dateString
) {

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/
      .exec(dateString);


  if (!match) {

    throw new Error(
      '日付の変換に失敗しました。'
    );
  }


  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);


  if (year < 2019) {

    throw new Error(
      '現在の自動取得は令和の日付に対応しています。'
    );
  }


  return {

    era:
      '令和',

    year:
      year - 2018,

    month,

    day

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

    /*
     * label一致
     */
    try {

      await select.selectOption({
        label:
          String(value)
      });

      return true;

    } catch {}


    /*
     * value一致
     */
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
   Open output selection page
========================================================= */

async function openOutputSelectionPage(p) {

  console.log(
    '=== OPEN OUTPUT SELECTION START ==='
  );


  /*
   * 直接アクセス
   */
  await p.goto(
    OUTPUT_SELECTION_URL,
    {
      waitUntil:
        'domcontentloaded',

      timeout:
        60000
    }
  );


  await waitPage(
    p,
    1500
  );


  console.log(
    'OUTPUT SELECTION URL:',
    p.url()
  );

  console.log(
    'OUTPUT SELECTION TITLE:',
    await getSafeTitle(p)
  );


  /*
   * ログイン画面へ戻った場合
   */
  if (!(await isLoggedIn(p))) {

    console.log(
      'Session lost. Logging in again...'
    );


    await autoLogin(p);


    /*
     * ログイン後もう一度
     * 出力対象選択を開く
     */
    await p.goto(
      OUTPUT_SELECTION_URL,
      {
        waitUntil:
          'domcontentloaded',

        timeout:
          60000
      }
    );


    await waitPage(
      p,
      1500
    );
  }


  const body =
    await getBodyText(p);


  console.log(
    'OUTPUT PAGE contains 看護記録書Ⅱ:',
    body.includes(
      '看護記録書Ⅱ'
    )
  );


  /*
   * ページ内リンクをデバッグ表示
   *
   * 患者データなどは出力しない。
   */
  const links =
    await p
      .locator('a')
      .evaluateAll(
        elements =>
          elements
            .map(el => ({
              text:
                (el.innerText || '')
                  .trim(),

              href:
                el.getAttribute('href') || ''
            }))
            .filter(
              item =>
                item.text.includes(
                  '看護記録'
                )
            )
            .slice(0, 20)
      )
      .catch(
        () => []
      );


  console.log(
    'NURSING RECORD LINKS:',
    JSON.stringify(
      links
    )
  );


  /*
   * 看護記録書Ⅱがない場合
   */
  if (
    !body.includes(
      '看護記録書Ⅱ'
    )
  ) {

    console.error(
      'CURRENT URL:',
      p.url()
    );

    console.error(
      'CURRENT TITLE:',
      await getSafeTitle(p)
    );


    throw new Error(
      '出力対象選択画面に「看護記録書Ⅱ」がありませんでした。'
    );
  }


  console.log(
    '=== OPEN OUTPUT SELECTION SUCCESS ==='
  );
}


/* =========================================================
   Click 看護記録書Ⅱ
========================================================= */

async function clickRecord2(p) {

  console.log(
    '=== CLICK 看護記録書Ⅱ START ==='
  );


  /*
   * まずaタグを優先
   */
  let recordLink =
    p.locator(
      'a',
      {
        hasText:
          '看護記録書Ⅱ'
      }
    ).first();


  /*
   * 見つからない場合は
   * テキスト全体から探す
   */
  if (
    await recordLink.count() < 1
  ) {

    recordLink =
      p.getByText(
        '看護記録書Ⅱ',
        {
          exact:
            true
        }
      ).first();
  }


  if (
    await recordLink.count() < 1
  ) {

    throw new Error(
      '「看護記録書Ⅱ」のリンクを検出できませんでした。'
    );
  }


  const href =
    await recordLink
      .getAttribute(
        'href'
      )
      .catch(
        () => null
      );


  console.log(
    '看護記録書Ⅱ link href exists:',
    Boolean(href)
  );


  /*
   * クリック
   */
  await recordLink.click();


  await waitPage(
    p,
    1800
  );


  console.log(
    'AFTER RECORD2 CLICK URL:',
    p.url()
  );

  console.log(
    'AFTER RECORD2 CLICK TITLE:',
    await getSafeTitle(p)
  );


  const body =
    await getBodyText(p);


  /*
   * 出力条件画面確認
   */
  const looksLikeExportPage =
    isExportUrl(
      p.url()
    ) ||

    (
      body.includes(
        '看護記録書Ⅱ'
      ) &&

      (
        body.includes(
          '出力条件'
        ) ||

        body.includes(
          'CSV出力'
        )
      )
    );


  if (!looksLikeExportPage) {

    console.error(
      'CURRENT URL:',
      p.url()
    );

    console.error(
      'CURRENT TITLE:',
      await getSafeTitle(p)
    );


    throw new Error(
      '看護記録書Ⅱをクリックしましたが、出力条件画面へ移動できませんでした。'
    );
  }


  console.log(
    '=== CLICK 看護記録書Ⅱ SUCCESS ==='
  );
}


/* =========================================================
   Open 看護記録書Ⅱ export page
========================================================= */

async function openExportPage(p) {

  console.log(
    '=== OPEN EXPORT PAGE START ==='
  );


  console.log(
    'START URL:',
    p.url()
  );


  /*
   * すでに出力条件画面なら終了
   */
  if (isExportUrl(p.url())) {

    console.log(
      'Already on export page'
    );

    return;
  }


  /*
   * 1. ログイン
   */
  await autoLogin(p);


  /*
   * 2. 出力対象選択を直接開く
   */
  await openOutputSelectionPage(p);


  /*
   * 3. 看護記録書Ⅱをクリック
   */
  await clickRecord2(p);


  console.log(
    '=== OPEN EXPORT PAGE SUCCESS ==='
  );
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
    '=== SET EXPORT DATES START ==='
  );


  console.log(
    'PERIOD:',
    from,
    '->',
    to
  );


  const startDate =
    toJapaneseEra(
      from
    );

  const endDate =
    toJapaneseEra(
      to
    );


  const selects =
    p.locator(
      'select:visible'
    );


  const count =
    await selects.count();


  console.log(
    'VISIBLE SELECT COUNT:',
    count
  );


  /*
   * 全selectのoptionを確認して
   * 最初の「令和」を探す
   */
  let startIndex =
    -1;


  for (
    let i = 0;
    i < count;
    i++
  ) {

    const options =
      await selects
        .nth(i)
        .locator(
          'option'
        )
        .allTextContents()
        .catch(
          () => []
        );


    const optionText =
      options.join('|');


    if (
      optionText.includes(
        '令和'
      )
    ) {

      startIndex =
        i;

      break;
    }
  }


  if (startIndex < 0) {

    /*
     * 元号selectが存在しない場合、
     * 年月日×2の6項目の可能性
     */
    console.log(
      'Era select not found. Trying 6-select date format.'
    );


    if (count < 6) {

      throw new Error(
        `訪問日の日付欄を検出できませんでした。select数=${count}`
      );
    }


    const values = [

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
        selects.nth(i);


      const success =
        await selectCandidate(
          target,
          [
            value,
            `${value}年`,
            `${value}月`,
            `${value}日`,
            String(value),
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
      '=== SET EXPORT DATES SUCCESS ==='
    );

    return;
  }


  /*
   * 元号あり
   *
   * 元号 / 年 / 月 / 日 × 2
   */
  if (
    count < startIndex + 8
  ) {

    throw new Error(
      `訪問日の選択欄が不足しています。select数=${count}`
    );
  }


  const values = [

    startDate.era,
    startDate.year,
    startDate.month,
    startDate.day,

    endDate.era,
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


    const candidates =
      i === 0 ||
      i === 4

        ? [
            '令和'
          ]

        : [
            value,
            `${value}年`,
            `${value}月`,
            `${value}日`,
            String(value),
            String(value)
              .padStart(
                2,
                '0'
              )
          ];


    const success =
      await selectCandidate(
        target,
        candidates
      );


    if (!success) {

      const options =
        await target
          .locator(
            'option'
          )
          .allTextContents()
          .catch(
            () => []
          );


      console.error(
        `DATE SELECT ${i + 1}:`,
        options
          .slice(
            0,
            30
          )
          .join('|')
      );


      throw new Error(
        `日付欄${i + 1}を設定できませんでした。`
      );
    }
  }


  console.log(
    '=== SET EXPORT DATES SUCCESS ==='
  );
}


/* =========================================================
   Find CSV button
========================================================= */

async function findCsvButton(p) {

  /*
   * button
   */
  const roleButton =
    p.getByRole(
      'button',
      {
        name:
          /CSV出力/
      }
    ).last();


  if (
    await roleButton.count() > 0 &&
    await roleButton
      .isVisible()
      .catch(
        () => false
      )
  ) {

    return roleButton;
  }


  /*
   * submit
   */
  const submitButton =
    p.locator(
      'input[type="submit"][value*="CSV"]'
    ).last();


  if (
    await submitButton.count() > 0 &&
    await submitButton
      .isVisible()
      .catch(
        () => false
      )
  ) {

    return submitButton;
  }


  /*
   * button element
   */
  const normalButton =
    p.locator(
      'button:has-text("CSV出力")'
    ).last();


  if (
    await normalButton.count() > 0 &&
    await normalButton
      .isVisible()
      .catch(
        () => false
      )
  ) {

    return normalButton;
  }


  /*
   * 最終手段
   */
  const text =
    p.getByText(
      'CSV出力',
      {
        exact:
          true
      }
    ).last();


  if (
    await text.count() > 0 &&
    await text
      .isVisible()
      .catch(
        () => false
      )
  ) {

    return text;
  }


  return null;
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

        running:
          true,

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

    let p =
      null;


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

        ok:
          true,

        loggedIn:
          true,

        message:
          'カイポケへ接続しました。'

      });


    } catch (e) {

      console.error(
        '=== CONNECT ERROR ==='
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
            'カイポケ接続に失敗しました。'

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

    let p =
      null;


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
          .test(
            from || ''
          ) ||

        !/^\d{4}-\d{2}-\d{2}$/
          .test(
            to || ''
          )
      ) {

        return res
          .status(400)
          .json({

            error:
              '日付が不正です。'

          });
      }


      if (from > to) {

        return res
          .status(400)
          .json({

            error:
              '開始日は終了日以前の日付を指定してください。'

          });
      }


      console.log(
        '=== EXPORT START ==='
      );


      console.log(
        'PERIOD:',
        from,
        '->',
        to
      );


      p =
        await getPage();


      /*
       * 1. ログイン
       */
      await autoLogin(p);


      /*
       * 2. 出力対象選択
       * 3. 看護記録書Ⅱ
       */
      await openExportPage(p);


      /*
       * 4. 日付設定
       */
      await setExportDates(
        p,
        from,
        to
      );


      /*
       * 5. CSV出力
       */
      const csvButton =
        await findCsvButton(p);


      if (!csvButton) {

        throw new Error(
          'CSV出力ボタンを検出できませんでした。'
        );
      }


      console.log(
        'CSV button found'
      );


      /*
       * ダウンロード待機
       */
      const downloadPromise =
        p.waitForEvent(
          'download',
          {
            timeout:
              120000
          }
        );


      await csvButton.click();


      console.log(
        'CSV button clicked'
      );


      const download =
        await downloadPromise;


      console.log(
        'Download event received'
      );


      /*
       * ダウンロード失敗確認
       */
      const failure =
        await download
          .failure()
          .catch(
            () => null
          );


      if (failure) {

        throw new Error(
          `CSVダウンロードに失敗しました: ${failure}`
        );
      }


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


      if (
        buffer.length < 1
      ) {

        throw new Error(
          '取得したCSVファイルが空です。'
        );
      }


      console.log(
        'CSV downloaded:',
        buffer.length,
        'bytes'
      );


      console.log(
        '=== EXPORT SUCCESS ==='
      );


      /*
       * WordPressへ返却
       */
      res.json({

        ok:
          true,

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
