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
  process.env.PROFILE_DIR ||
  '/data/kaipoke-profile';

const LOGIN_URL =
  'https://r.kaipoke.biz/kaipokebiz/login/COM020102.do';

/*
 * 今回確認できた「各種情報出力 → 出力対象選択」画面。
 *
 * conversationContext はセッションによって変わるため、
 * URLには付けない。
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


function isExportUrl(url = '') {

  return (
    /\/bizhnc\/careRecordDocument2Export/i
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


/*
 * ページ遷移後の短い待機
 */
async function waitAfterNavigation(
  p,
  ms = 1000
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
   * ログインフォームが見えている
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
   * ログアウトが表示されていれば
   * 確実にログイン済み
   */
  if (text.includes('ログアウト')) {
    return true;
  }


  /*
   * Kaipokeドメイン内で、
   * ログイン画面でなければログイン済み扱い
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
   * 現在のページでログイン済みなら
   * そのまま使用
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
      waitUntil:
        'domcontentloaded',

      timeout:
        60000
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
   * セッションが残っていて
   * 自動的にログイン済みになった場合
   */
  if (await isLoggedIn(p)) {

    console.log(
      'Logged in by existing session'
    );

    return true;
  }


  /*
   * 法人ID / ユーザーID
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
   * 実際のログイン画面では
   *
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


  let loginButton = null;


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
   * ログイン
   */
  await Promise.all([

    p
      .waitForLoadState(
        'domcontentloaded',
        {
          timeout:
            60000
        }
      )
      .catch(() => {}),

    loginButton.click()

  ]);


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
   * ログイン成功確認
   */
  if (
    !(await isLoggedIn(p))
  ) {

    const body =
      await getBodyText(p);


    /*
     * 認証情報はログへ出さない
     */
    let safePreview =
      body;


    for (
      const secretValue
      of [
        KP_CORPORATE_ID,
        KP_USER_ID,
        KP_PASS
      ]
    ) {

      if (
        secretValue
      ) {

        safePreview =
          safePreview
            .split(
              secretValue
            )
            .join(
              '[REDACTED]'
            );
      }
    }


    console.error(
      'LOGIN PAGE MESSAGE:',
      safePreview.slice(
        0,
        500
      )
    );


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
   Japanese era
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


  /*
   * 現在の対象期間は令和
   */
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

      await select
        .selectOption({
          label:
            String(value)
        });

      return true;

    } catch {}


    /*
     * value一致
     */
    try {

      await select
        .selectOption(
          String(value)
        );

      return true;

    } catch {}
  }


  return false;
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
  if (
    isExportUrl(
      p.url()
    )
  ) {

    console.log(
      'Already on 看護記録書Ⅱ export page'
    );

    return;
  }


  /*
   * 念のためログイン確認
   */
  if (
    !(await isLoggedIn(p))
  ) {

    console.log(
      'Not logged in. Logging in...'
    );

    await autoLogin(p);
  }


  /*
   * =====================================================
   * STEP 1
   * 「各種情報出力 → 出力対象選択」画面へ移動
   * =====================================================
   */

  console.log(
    'Opening 出力対象選択 page...'
  );


  await p.goto(
    OUTPUT_SELECTION_URL,
    {
      waitUntil:
        'domcontentloaded',

      timeout:
        60000
    }
  );


  await p.waitForTimeout(
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
   * セッション切れ確認
   */
  if (
    !(await isLoggedIn(p))
  ) {

    console.log(
      'Session expired while opening output selection page.'
    );


    await autoLogin(p);


    /*
     * ログインし直した後に
     * もう一度出力対象選択画面へ
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


    await p.waitForTimeout(
      1500
    );
  }


  /*
   * 出力対象選択画面を確認
   */
  const selectionBody =
    await getBodyText(p);


  console.log(
    'Selection page contains 看護記録書Ⅱ:',
    selectionBody.includes(
      '看護記録書Ⅱ'
    )
  );


  if (
    !selectionBody.includes(
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
      '各種情報出力画面で「看護記録書Ⅱ」を検出できませんでした。'
    );
  }


  /*
   * =====================================================
   * STEP 2
   * 「看護記録書Ⅱ」のリンクを取得
   * =====================================================
   */

  console.log(
    'Searching 看護記録書Ⅱ link...'
  );


  /*
   * まずリンクとして探す
   */
  let recordLink =
    p
      .locator(
        'a',
        {
          hasText:
            '看護記録書Ⅱ'
        }
      )
      .first();


  let linkCount =
    await recordLink.count();


  /*
   * 見つからなければ
   * テキストから探す
   */
  if (
    linkCount < 1
  ) {

    recordLink =
      p
        .getByText(
          '看護記録書Ⅱ',
          {
            exact:
              true
          }
        )
        .first();


    linkCount =
      await recordLink.count();
  }


  if (
    linkCount < 1
  ) {

    throw new Error(
      '「看護記録書Ⅱ」のリンクを検出できませんでした。'
    );
  }


  /*
   * hrefをログに確認
   *
   * ※値そのものは後から変化する可能性があるので
   *   コードには固定しない
   */
  const href =
    await recordLink
      .getAttribute(
        'href'
      )
      .catch(
        () => null
      );


  console.log(
    '看護記録書Ⅱ link found:',
    href
      ? 'yes'
      : 'no href'
  );


  /*
   * =====================================================
   * STEP 3
   * 看護記録書Ⅱをクリック
   * =====================================================
   */

  console.log(
    'Clicking 看護記録書Ⅱ...'
  );


  await Promise.all([

    p
      .waitForLoadState(
        'domcontentloaded',
        {
          timeout:
            60000
        }
      )
      .catch(() => {}),

    recordLink.click()

  ]);


  await p.waitForTimeout(
    1500
  );


  console.log(
    'AFTER RECORD2 CLICK URL:',
    p.url()
  );

  console.log(
    'AFTER RECORD2 CLICK TITLE:',
    await getSafeTitle(p)
  );


  /*
   * =====================================================
   * STEP 4
   * 出力条件画面確認
   * =====================================================
   */

  const exportBody =
    await getBodyText(p);


  const exportPageDetected =
    isExportUrl(
      p.url()
    ) ||
    (
      exportBody.includes(
        '看護記録書Ⅱ'
      ) &&
      exportBody.includes(
        '出力条件'
      ) &&
      exportBody.includes(
        'CSV出力'
      )
    );


  if (
    !exportPageDetected
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
      '「看護記録書Ⅱ」をクリックしましたが、出力条件画面へ移動できませんでした。'
    );
  }


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
    'Requested:',
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
    'Visible selects:',
    count
  );


  /*
   * 実際の画面では
   *
   * 開始:
   * 元号 / 年 / 月 / 日
   *
   * 終了:
   * 元号 / 年 / 月 / 日
   *
   * 合計8個
   */
  if (
    count < 8
  ) {

    throw new Error(
      `訪問日の選択欄を8個検出できませんでした。検出数=${count}`
    );
  }


  /*
   * 「令和」が入っているselectを探す
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
        .allTextContents();


    const text =
      options.join(
        '|'
      );


    if (
      text.includes(
        '令和'
      )
    ) {

      startIndex =
        i;

      break;
    }
  }


  if (
    startIndex < 0
  ) {

    throw new Error(
      '訪問日の「令和」選択欄を検出できませんでした。'
    );
  }


  console.log(
    'Date selects start index:',
    startIndex
  );


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


    if (
      !success
    ) {

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
        `DATE SELECT ${i + 1} OPTIONS:`,
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
   CSV button
========================================================= */

async function findCsvButton(p) {

  /*
   * まずボタン
   */
  const button =
    p
      .getByRole(
        'button',
        {
          name:
            'CSV出力'
        }
      )
      .last();


  if (
    await button.count() > 0
  ) {

    if (
      await button
        .isVisible()
        .catch(
          () => false
        )
    ) {

      return button;
    }
  }


  /*
   * input submit
   */
  const submit =
    p
      .locator(
        'input[type="submit"][value*="CSV"]'
      )
      .last();


  if (
    await submit.count() > 0
  ) {

    if (
      await submit
        .isVisible()
        .catch(
          () => false
        )
    ) {

      return submit;
    }
  }


  /*
   * テキスト
   */
  const text =
    p
      .getByText(
        'CSV出力',
        {
          exact:
            true
        }
      )
      .last();


  if (
    await text.count() > 0
  ) {

    if (
      await text
        .isVisible()
        .catch(
          () => false
        )
    ) {

      return text;
    }
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

    let p =
      null;


    try {

      const {
        from,
        to
      } =
        req.body || {};


      /*
       * 日付形式チェック
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


      if (
        from > to
      ) {

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
       * 2. 各種情報出力
       *    ↓
       *    看護記録書Ⅱ
       *    ↓
       *    出力条件画面
       */
      await openExportPage(p);


      /*
       * 3. 日付設定
       */
      await setExportDates(
        p,
        from,
        to
      );


      /*
       * 4. CSV出力ボタン
       */
      const csvButton =
        await findCsvButton(p);


      if (
        !csvButton
      ) {

        throw new Error(
          'CSV出力ボタンを検出できませんでした。'
        );
      }


      console.log(
        'CSV button found'
      );


      /*
       * 5. CSVダウンロード
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


      if (
        failure
      ) {

        throw new Error(
          `CSVダウンロードに失敗しました: ${failure}`
        );
      }


      const temporaryPath =
        await download.path();


      if (
        !temporaryPath
      ) {

        throw new Error(
          'CSVファイルを取得できませんでした。'
        );
      }


      /*
       * ファイル読込
       */
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
