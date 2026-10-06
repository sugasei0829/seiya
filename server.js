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

/* =========================================================
   Kaipoke navigation helpers
========================================================= */

function safeUrlInfo(rawUrl = '') {

  try {

    const u =
      new URL(rawUrl);

    return {

      host:
        u.hostname,

      path:
        u.pathname,

      hasConversationContext:
        u.searchParams.has(
          'conversationContext'
        )

    };

  } catch {

    return {

      host:
        '',

      path:
        '',

      hasConversationContext:
        false

    };
  }
}


async function logCurrentPage(
  p,
  label
) {

  const info =
    safeUrlInfo(
      p.url()
    );

  console.log(
    `${label} HOST:`,
    info.host
  );

  console.log(
    `${label} PATH:`,
    info.path
  );

  console.log(
    `${label} HAS CONTEXT:`,
    info.hasConversationContext
  );

  console.log(
    `${label} TITLE:`,
    await getSafeTitle(p)
  );
}


/*
 * リンクをクリックして
 * 画面遷移を待つ
 */

async function clickAndWait(
  p,
  locator,
  waitMs = 1500
) {

  const beforeUrl =
    p.url();

  await locator.click();

  /*
   * 通常のページ遷移を待つ
   */
  await p
    .waitForLoadState(
      'domcontentloaded',
      {
        timeout:
          30000
      }
    )
    .catch(() => {});


  /*
   * カイポケはSSO中継ページを通ることがある。
   *
   * Loading...
   * /common/sso.do
   *
   * 等が終わるまで待つ。
   */
  const startedAt =
    Date.now();

  while (
    Date.now() - startedAt <
    15000
  ) {

    const currentUrl =
      p.url();

    const currentTitle =
      await getSafeTitle(p);

    const body =
      await getBodyText(p);


    const loadingSso =
      /\/common\/sso\.do/i.test(
        currentUrl
      ) ||

      /^Loading/i.test(
        currentTitle
      ) ||

      body.trim() === '';


    if (!loadingSso) {
      break;
    }


    console.log(
      'Waiting for Kaipoke SSO...'
    );


    await p.waitForTimeout(
      500
    );
  }


  /*
   * SSO後のJavaScript描画待ち
   */
  await p.waitForTimeout(
    waitMs
  );


  console.log(
    'Page changed:',
    beforeUrl !== p.url()
  );
}

/* =========================================================
   Open Kaipoke service selection page
========================================================= */

async function openServiceSelectionPage(p) {

  console.log(
    '=== OPEN SERVICE SELECTION START ==='
  );

  /*
   * 1. ログイン確認
   */
  await autoLogin(p);


  /*
   * すでに訪問看護システム内なら
   * そのまま使う
   */
  if (
    /\/bizhnc\//i.test(
      p.url()
    )
  ) {

    console.log(
      'Already inside visiting nursing service'
    );

    await logCurrentPage(
      p,
      'NURSING'
    );

    return;
  }


  /*
   * すでに正しい出力対象選択画面なら
   * そのまま使う
   */
  if (
    isOutputSelectionUrl(
      p.url()
    )
  ) {

    const body =
      await getBodyText(p);

    if (
      body.includes(
        '看護記録書Ⅱ'
      )
    ) {

      console.log(
        'Already inside correct nursing context'
      );

      return;
    }
  }


  /*
   * 2. カイポケTOPへ移動
   */
  console.log(
    'Opening Kaipoke top...'
  );

  await p.goto(
    'https://r.kaipoke.biz/biztop/',
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


  if (!(await isLoggedIn(p))) {

    console.log(
      'Session expired. Logging in again...'
    );

    await autoLogin(p);

    await p.goto(
      'https://r.kaipoke.biz/biztop/',
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


  await logCurrentPage(
    p,
    'BIZTOP'
  );


  /*
   * 3. 必ず「レセプト」を探す
   *
   * biztop上の「訪問看護」という文字は
   * ここでは絶対にクリックしない。
   */
  console.log(
    'Searching レセプト...'
  );


  const receiptCandidates = [

    p.locator(
      'a'
    ).filter({
      hasText:
        'レセプト'
    }),

    p.getByText(
      'レセプト',
      {
        exact:
          true
      }
    )

  ];


  let receiptLink =
    null;


  for (
    const candidate
    of receiptCandidates
  ) {

    const count =
      await candidate
        .count()
        .catch(
          () => 0
        );


    for (
      let i = 0;
      i < count;
      i++
    ) {

      const item =
        candidate.nth(i);


      const visible =
        await item
          .isVisible()
          .catch(
            () => false
          );


      if (!visible) {
        continue;
      }


      const href =
        await item
          .getAttribute(
            'href'
          )
          .catch(
            () => ''
          );


      /*
       * "#"だけのリンクは除外
       */
      if (
        href === '#' ||
        href === ''
      ) {

        continue;
      }


      receiptLink =
        item;

      break;
    }


    if (receiptLink) {
      break;
    }
  }


  /*
   * hrefがない場合は
   * onclick型の可能性があるので
   * 表示中の「レセプト」を許可
   */
  if (!receiptLink) {

    const fallback =
      p.getByText(
        'レセプト',
        {
          exact:
            true
        }
      );


    const count =
      await fallback
        .count()
        .catch(
          () => 0
        );


    for (
      let i = 0;
      i < count;
      i++
    ) {

      const item =
        fallback.nth(i);


      if (
        await item
          .isVisible()
          .catch(
            () => false
          )
      ) {

        receiptLink =
          item;

        break;
      }
    }
  }


  if (!receiptLink) {

    throw new Error(
      'カイポケTOPの「レセプト」を検出できませんでした。'
    );
  }


  console.log(
    'Clicking レセプト...'
  );


await clickAndWait(
  p,
  receiptLink,
  3000
);


  await logCurrentPage(
    p,
    'AFTER RECEIPT'
  );


  /*
   * 4. レセプト情報画面確認
   *
   * スクショではここに
   * 事業所一覧が表示される。
   */
  let receiptBody =
    await getBodyText(p);


  console.log(
    'Receipt page contains 訪問看護:',
    receiptBody.includes(
      '訪問看護'
    )
  );


  /*
   * 5. レセプト情報画面から
   * 訪問看護事業所を探す
   *
   * カイポケは href ではなく
   * onclick / JavaScript で遷移する場合があるため
   * href必須にはしない。
   */
  console.log(
    'Searching visiting nursing office on receipt page...'
  );


  const nursingCandidates =
    p.getByText(
      /訪問看護/
    );


  const nursingCandidateCount =
    await nursingCandidates
      .count()
      .catch(
        () => 0
      );


  console.log(
    'Visiting nursing text candidate count:',
    nursingCandidateCount
  );


  let nursingLink =
    null;


  for (
    let i = 0;
    i < nursingCandidateCount;
    i++
  ) {

    const candidate =
      nursingCandidates.nth(i);


    const visible =
      await candidate
        .isVisible()
        .catch(
          () => false
        );


    if (!visible) {
      continue;
    }


    const text =
      (
        await candidate
          .innerText()
          .catch(
            () => ''
          )
      )
        .replace(
          /\s+/g,
          ' '
        )
        .trim();


    /*
     * ログには事業所名そのものを出さない
     */
    console.log(
      'Found visible visiting nursing candidate:',
      Boolean(text)
    );


    /*
     * まず本人がクリック可能か確認
     */
    const tagName =
      await candidate
        .evaluate(
          el =>
            el.tagName
        )
        .catch(
          () => ''
        );


    console.log(
      'Candidate tag:',
      tagName
    );


    if (
      tagName === 'A' ||
      tagName === 'BUTTON'
    ) {

      nursingLink =
        candidate;

      break;
    }


    /*
     * テキスト自身がspan等の場合、
     * 一番近いクリック可能な親を探す
     */
    const clickableParent =
      candidate.locator(
        'xpath=ancestor-or-self::a | ancestor-or-self::button'
      ).first();


    if (
      await clickableParent
        .count()
        .catch(
          () => 0
        ) > 0
    ) {

      if (
        await clickableParent
          .isVisible()
          .catch(
            () => false
          )
      ) {

        nursingLink =
          clickableParent;

        break;
      }
    }


    /*
     * onclickが付いた親要素も確認
     */
    const onclickParent =
      candidate.locator(
        'xpath=ancestor-or-self::*[@onclick]'
      ).first();


    if (
      await onclickParent
        .count()
        .catch(
          () => 0
        ) > 0
    ) {

      if (
        await onclickParent
          .isVisible()
          .catch(
            () => false
          )
      ) {

        nursingLink =
          onclickParent;

        break;
      }
    }
  }


  /*
   * getByTextで見つからなかった場合は
   * aタグを直接再検索
   */
  if (!nursingLink) {

    console.log(
      'Trying direct anchor search...'
    );


    const directLinks =
      p.locator(
        'a'
      );


    const directCount =
      await directLinks.count();


    for (
      let i = 0;
      i < directCount;
      i++
    ) {

      const item =
        directLinks.nth(i);


      if (
        !(await item
          .isVisible()
          .catch(
            () => false
          ))
      ) {

        continue;
      }


      const text =
        (
          await item
            .innerText()
            .catch(
              () => ''
            )
        )
          .replace(
            /\s+/g,
            ' '
          )
          .trim();


      if (
        text.includes(
          '訪問看護'
        )
      ) {

        nursingLink =
          item;

        break;
      }
    }
  }


  if (!nursingLink) {

    throw new Error(
      'レセプト情報画面に「訪問看護」は表示されていますが、クリック可能な事業所要素を検出できませんでした。'
    );
  }


  /*
   * 遷移方式を確認
   *
   * URLやonclickの中身そのものは
   * ID等を含む可能性があるのでログには出さない。
   */
  const nursingHref =
    await nursingLink
      .getAttribute(
        'href'
      )
      .catch(
        () => null
      );


  const nursingOnclick =
    await nursingLink
      .getAttribute(
        'onclick'
      )
      .catch(
        () => null
      );


  console.log(
    'Nursing office has href:',
    Boolean(
      nursingHref
    )
  );


  console.log(
    'Nursing office has onclick:',
    Boolean(
      nursingOnclick
    )
  );



  console.log(
    'Clicking visiting nursing office from receipt page...'
  );


  await clickAndWait(
    p,
    nursingLink,
    2500
  );


  await logCurrentPage(
    p,
    'AFTER NURSING OFFICE'
  );


  /*
   * 6. 訪問看護システムへ
   * 入ったことを確認
   */
  const nursingBody =
    await getBodyText(p);


  const isNursingSystem =
    /\/bizhnc\//i.test(
      p.url()
    ) ||

    (
      nursingBody.includes(
        '各種情報出力'
      ) &&
      nursingBody.includes(
        'スケジュール管理'
      )
    );


  if (!isNursingSystem) {

    throw new Error(
      'レセプト情報画面から訪問看護事業所を選択しましたが、訪問看護システムへ移動できませんでした。'
    );
  }


  console.log(
    '=== VISITING NURSING CONTEXT READY ==='
  );
}



/* =========================================================
   Open output selection page
========================================================= */

async function openOutputSelectionPage(p) {

  console.log(
    '=== OPEN OUTPUT SELECTION START ==='
  );


  /*
   * まず訪問看護の事業所コンテキストを作る。
   *
   * ここが今回の重要な修正点。
   */
  await openServiceSelectionPage(
    p
  );


  /*
   * すでに正しい出力対象選択画面なら
   * そのまま利用する。
   */
  if (
    isOutputSelectionUrl(
      p.url()
    )
  ) {

    const currentBody =
      await getBodyText(p);


    if (
      currentBody.includes(
        '看護記録書Ⅱ'
      )
    ) {

      console.log(
        'Already on correct output selection page'
      );

      return;
    }
  }


  /*
   * 「各種情報出力」を探す。
   *
   * スクショでは上部ナビゲーションに存在。
   */
  console.log(
    'Searching 各種情報出力...'
  );


  const outputMenuCandidates = [

    p.getByText(
      '各種情報出力',
      {
        exact:
          true
      }
    ),

    p.locator(
      'a'
    ).filter({
      hasText:
        '各種情報出力'
    })

  ];


  let outputMenu =
    null;


  for (
    const candidate
    of outputMenuCandidates
  ) {

    const count =
      await candidate
        .count()
        .catch(
          () => 0
        );


    if (count < 1) {
      continue;
    }


    for (
      let i = 0;
      i < count;
      i++
    ) {

      const item =
        candidate.nth(i);


      if (
        await item
          .isVisible()
          .catch(
            () => false
          )
      ) {

        outputMenu =
          item;

        break;
      }
    }


    if (outputMenu) {
      break;
    }
  }


  if (!outputMenu) {

    throw new Error(
      '訪問看護画面の「各種情報出力」を検出できませんでした。'
    );
  }


  /*
   * スクショでは
   * 各種情報出力にマウスを乗せると
   * 「出力対象選択」が表示される。
   */
  console.log(
    'Hovering 各種情報出力...'
  );


  await outputMenu.hover();


  await p.waitForTimeout(
    700
  );


  /*
   * 出力対象選択を探す
   */
  const selectionCandidates = [

    p.getByText(
      '出力対象選択',
      {
        exact:
          true
      }
    ),

    p.locator(
      'a'
    ).filter({
      hasText:
        '出力対象選択'
    })

  ];


  let selectionLink =
    null;


  for (
    const candidate
    of selectionCandidates
  ) {

    const count =
      await candidate
        .count()
        .catch(
          () => 0
        );


    if (count < 1) {
      continue;
    }


    for (
      let i = 0;
      i < count;
      i++
    ) {

      const item =
        candidate.nth(i);


      if (
        await item
          .isVisible()
          .catch(
            () => false
          )
      ) {

        selectionLink =
          item;

        break;
      }
    }


    if (selectionLink) {
      break;
    }
  }


  /*
   * hoverで出ない場合、
   * 各種情報出力自体をクリックして
   * 再検索する。
   */
  if (!selectionLink) {

    console.log(
      'Output submenu not visible after hover. Trying click...'
    );


    await outputMenu.click();


    await p.waitForTimeout(
      700
    );


    const retry =
      p.getByText(
        '出力対象選択',
        {
          exact:
            true
        }
      );


    const retryCount =
      await retry
        .count()
        .catch(
          () => 0
        );


    for (
      let i = 0;
      i < retryCount;
      i++
    ) {

      const item =
        retry.nth(i);


      if (
        await item
          .isVisible()
          .catch(
            () => false
          )
      ) {

        selectionLink =
          item;

        break;
      }
    }
  }


  if (!selectionLink) {

    throw new Error(
      '「各種情報出力」メニュー内の「出力対象選択」を検出できませんでした。'
    );
  }


  /*
   * 出力対象選択リンクに
   * conversationContextが含まれているかだけ確認。
   *
   * 値自体はログへ出さない。
   */
  const href =
    await selectionLink
      .getAttribute(
        'href'
      )
      .catch(
        () => ''
      );


  const hrefInfo =
    safeUrlInfo(
      href
    );


  console.log(
    'Output selection link path:',
    hrefInfo.path
  );

  console.log(
    'Output selection link has context:',
    hrefInfo.hasConversationContext
  );


  /*
   * 人間と同じようにクリックする。
   *
   * OUTPUT_SELECTION_URLへの
   * 直接gotoはしない。
   */
  console.log(
    'Clicking 出力対象選択...'
  );


  await clickAndWait(
    p,
    selectionLink,
    1800
  );


  await logCurrentPage(
    p,
    'OUTPUT SELECTION'
  );


  /*
   * 正しいページか確認
   */
  const body =
    await getBodyText(p);


  console.log(
    'Contains 個別帳票データ:',
    body.includes(
      '個別帳票データ'
    )
  );


  console.log(
    'Contains 看護記録書Ⅱ:',
    body.includes(
      '看護記録書Ⅱ'
    )
  );


  if (
    !body.includes(
      '看護記録書Ⅱ'
    )
  ) {

    /*
     * デバッグ用。
     *
     * 患者情報やURLパラメータは
     * ログに出さない。
     */
    const nursingLinks =
      await p
        .locator(
          'a'
        )
        .evaluateAll(
          elements =>
            elements
              .map(
                el => ({
                  text:
                    (
                      el.innerText ||
                      ''
                    ).trim(),

                  path:
                    (() => {

                      try {

                        return new URL(
                          el.href
                        ).pathname;

                      } catch {

                        return '';
                      }

                    })()
                })
              )
              .filter(
                item =>
                  item.text.includes(
                    '看護記録'
                  )
              )
              .slice(
                0,
                10
              )
        )
        .catch(
          () => []
        );


    console.log(
      'NURSING RECORD LINK COUNT:',
      nursingLinks.length
    );


    throw new Error(
      '訪問看護の事業所を選択して出力対象選択へ進みましたが、「看護記録書Ⅱ」が表示されませんでした。'
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
   * ページ内には
   * 非表示メニュー側と
   * 実際の個別帳票データ側の
   * 「看護記録書Ⅱ」が存在する。
   *
   * 必ず visible のものを選択する。
   */
  const candidates =
    p.locator(
      'a'
    ).filter({
      hasText:
        '看護記録書Ⅱ'
    });


  const count =
    await candidates.count();


  console.log(
    '看護記録書Ⅱ candidate count:',
    count
  );


  let recordLink =
    null;


  for (
    let i = 0;
    i < count;
    i++
  ) {

    const candidate =
      candidates.nth(i);


    const visible =
      await candidate
        .isVisible()
        .catch(
          () => false
        );


    console.log(
      `看護記録書Ⅱ candidate ${i + 1} visible:`,
      visible
    );


    if (!visible) {
      continue;
    }


    recordLink =
      candidate;

    break;
  }


  /*
   * aタグで見つからなかった場合
   */
  if (!recordLink) {

    const textCandidates =
      p.getByText(
        '看護記録書Ⅱ',
        {
          exact:
            true
        }
      );


    const textCount =
      await textCandidates.count();


    for (
      let i = 0;
      i < textCount;
      i++
    ) {

      const candidate =
        textCandidates.nth(i);


      if (
        await candidate
          .isVisible()
          .catch(
            () => false
          )
      ) {

        recordLink =
          candidate;

        break;
      }
    }
  }


  if (!recordLink) {

    throw new Error(
      '表示中の「看護記録書Ⅱ」リンクを検出できませんでした。'
    );
  }


  /*
   * href / onclick の有無だけ確認。
   * 中身はログに出さない。
   */
  const href =
    await recordLink
      .getAttribute(
        'href'
      )
      .catch(
        () => null
      );


  const onclick =
    await recordLink
      .getAttribute(
        'onclick'
      )
      .catch(
        () => null
      );


  console.log(
    'Visible 看護記録書Ⅱ has href:',
    Boolean(href)
  );


  console.log(
    'Visible 看護記録書Ⅱ has onclick:',
    Boolean(onclick)
  );


  /*
   * 実際にクリック
   */
  console.log(
    'Clicking visible 看護記録書Ⅱ...'
  );


  await clickAndWait(
    p,
    recordLink,
    2000
  );


  console.log(
    'AFTER RECORD2 CLICK PATH:',
    safeUrlInfo(
      p.url()
    ).path
  );


  console.log(
    'AFTER RECORD2 CLICK HAS CONTEXT:',
    safeUrlInfo(
      p.url()
    ).hasConversationContext
  );


  console.log(
    'AFTER RECORD2 CLICK TITLE:',
    await getSafeTitle(p)
  );


  const body =
    await getBodyText(p);


  /*
   * 出力条件設定画面確認
   */
  const looksLikeExportPage =

    isExportUrl(
      p.url()
    )

    ||

    (
      body.includes(
        '看護記録書Ⅱ'
      )

      &&

      body.includes(
        'CSV出力'
      )
    );


  console.log(
    'Export page detected:',
    looksLikeExportPage
  );


  if (!looksLikeExportPage) {

    throw new Error(
      '「看護記録書Ⅱ」をクリックしましたが、出力条件設定画面へ移動できませんでした。'
    );
  }


  console.log(
    '=== CLICK 看護記録書Ⅱ SUCCESS ==='
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
