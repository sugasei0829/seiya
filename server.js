import express from 'express';
import { chromium } from 'playwright';
import fs from 'fs';

/* =========================================================
   Environment
========================================================= */

const PORT = Number(
  process.env.PORT || 38765
);

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

const BIZTOP_URL =
  'https://r.kaipoke.biz/biztop/';


if (!SECRET) {
  throw new Error(
    'BRIDGE_SECRET is required'
  );
}


/* =========================================================
   Express
========================================================= */

const app =
  express();


app.use(
  express.json({
    limit: '1mb'
  })
);


/*
 * WordPress → Railway 認証
 */
app.use(
  (req, res, next) => {

    const receivedSecret =
      req.get(
        'X-Bridge-Secret'
      );


    if (
      receivedSecret !== SECRET
    ) {

      return res
        .status(401)
        .json({
          error:
            'Unauthorized'
        });
    }


    next();
  }
);


/* =========================================================
   Playwright
========================================================= */

let browserContext =
  null;


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
      await chromium
        .launchPersistentContext(
          PROFILE,
          {
            headless: true,

            acceptDownloads:
              true,

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


  if (
    pages.length > 0
  ) {

    return pages[0];
  }


  return await context
    .newPage();
}


/* =========================================================
   Basic helpers
========================================================= */

function isKaipoke(
  url = ''
) {

  try {

    const hostname =
      new URL(
        url
      ).hostname;


    return (
      hostname ===
        'kaipoke.biz' ||

      hostname.endsWith(
        '.kaipoke.biz'
      )
    );

  } catch {

    return false;
  }
}


function isLoginUrl(
  url = ''
) {

  return (
    /\/login\/COM020102\.do/i
      .test(
        url
      )
  );
}


function isOutputSelectionUrl(
  url = ''
) {

  return (
    /\/business\/various_outputs\/HNC096201\.do/i
      .test(
        url
      )
  );
}


function isExportUrl(
  url = ''
) {

  return (
    /careRecordDocument2Export/i
      .test(
        url
      )
  );
}


function safeUrlInfo(
  rawUrl = ''
) {

  try {

    const u =
      new URL(
        rawUrl
      );


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


async function getBodyText(
  p
) {

  try {

    return await p
      .locator(
        'body'
      )
      .innerText();

  } catch {

    return '';
  }
}


async function getSafeTitle(
  p
) {

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
        timeout:
          30000
      }
    )
    .catch(
      () => {}
    );


  await p
    .waitForTimeout(
      ms
    );
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
    info
      .hasConversationContext
  );


  console.log(
    `${label} TITLE:`,
    await getSafeTitle(
      p
    )
  );
}


/* =========================================================
   Navigation helper
========================================================= */

async function clickAndWait(
  p,
  locator,
  waitMs = 1500
) {

  const beforeUrl =
    p.url();


  await locator.click();


  await p
    .waitForLoadState(
      'domcontentloaded',
      {
        timeout:
          30000
      }
    )
    .catch(
      () => {}
    );


  /*
   * Kaipoke SSO待機
   */
  const startedAt =
    Date.now();


  while (
    Date.now() -
      startedAt <
    15000
  ) {

    const currentUrl =
      p.url();


    const currentTitle =
      await getSafeTitle(
        p
      );


    const body =
      await getBodyText(
        p
      );


    const loadingSso =

      /\/common\/sso\.do/i
        .test(
          currentUrl
        )

      ||

      /^Loading/i
        .test(
          currentTitle
        )

      ||

      body.trim() === '';


    if (!loadingSso) {
      break;
    }


    console.log(
      'Waiting for Kaipoke SSO...'
    );


    await p
      .waitForTimeout(
        500
      );
  }


  await p
    .waitForTimeout(
      waitMs
    );


  console.log(
    'Page changed:',
    beforeUrl !==
      p.url()
  );
}


/* =========================================================
   Login state
========================================================= */

async function isLoggedIn(p) {

  const url = p.url();

  /*
   * Kaipoke以外
   */
  if (!isKaipoke(url)) {
    return false;
  }

  /*
   * ログイン画面
   */
  if (isLoginUrl(url)) {
    return false;
  }

  /*
   * 非会員・セッション切れ・エラー画面
   *
   * 今回ここが重要
   */
  if (
    /\/nonmember\//i.test(url) ||
    /\/error\.html/i.test(url)
  ) {

    console.log(
      'Kaipoke session is invalid (nonmember/error page)'
    );

    return false;
  }


  const text =
    await getBodyText(p);


  /*
   * ログインフォームが表示されている
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
   * 明確にログイン後と判断できるもの
   */
  if (
    text.includes('ログアウト') ||
    text.includes('共通メニュー') ||
    text.includes('各種情報出力') ||
    /\/bizhnc\//i.test(url)
  ) {

    return true;
  }


  /*
   * 判断できない画面を
   * 「ログイン済み」にしない
   */
  return false;
}

/* =========================================================
   Kaipoke login
========================================================= */

async function autoLogin(
  p
) {

  console.log(
    '=== KAIPOKE LOGIN START ==='
  );


  if (
    await isLoggedIn(
      p
    )
  ) {

    console.log(
      'Already logged in'
    );

    return true;
  }


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


  await p
    .waitForTimeout(
      1000
    );


  await logCurrentPage(
    p,
    'LOGIN'
  );


  if (
    await isLoggedIn(
      p
    )
  ) {

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
    await textInputs
      .count();


  console.log(
    'Visible text inputs:',
    textCount
  );


  if (
    textCount < 2
  ) {

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
    )
    .first();


  if (
    await passwordInput
      .count() < 1
  ) {

    throw new Error(
      'パスワード入力欄を検出できませんでした。'
    );
  }


  await passwordInput
    .fill(
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
      )
      .first();


    if (
      await candidate
        .count() < 1
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


  if (
    !loginButton
  ) {

    throw new Error(
      'カイポケのログインボタンを検出できませんでした。'
    );
  }


  await loginButton
    .click();


  await waitPage(
    p,
    2000
  );


  await logCurrentPage(
    p,
    'AFTER LOGIN'
  );


  if (
    !(
      await isLoggedIn(
        p
      )
    )
  ) {

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
   Open visiting nursing service
========================================================= */

async function openServiceSelectionPage(
  p
) {

  console.log(
    '=== OPEN SERVICE SELECTION START ==='
  );


  await autoLogin(
    p
  );


  /*
   * すでに訪問看護システム内
   */
  if (
    /\/bizhnc\//i
      .test(
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


    console.log(
      '=== VISITING NURSING CONTEXT READY ==='
    );


    return;
  }


  /*
   * すでに正しい
   * 出力対象選択画面
   */
  if (
    isOutputSelectionUrl(
      p.url()
    )
  ) {

    const body =
      await getBodyText(
        p
      );


    if (
      body.includes(
        '看護記録書Ⅱ'
      )
    ) {

      console.log(
        'Already inside correct nursing context'
      );


      console.log(
        '=== VISITING NURSING CONTEXT READY ==='
      );


      return;
    }
  }


  /*
   * カイポケTOP
   */
  console.log(
    'Opening Kaipoke top...'
  );


  await p.goto(
    BIZTOP_URL,
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


  if (
    !(
      await isLoggedIn(
        p
      )
    )
  ) {

    console.log(
      'Session expired. Logging in again...'
    );


    await autoLogin(
      p
    );


    await p.goto(
      BIZTOP_URL,
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
   * レセプトを探す
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
        candidate.nth(
          i
        );


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
       * 通常リンクを優先
       */
      if (
        href &&
        href !== '#'
      ) {

        receiptLink =
          item;

        break;
      }
    }


    if (
      receiptLink
    ) {

      break;
    }
  }


  /*
   * onclick型などへのfallback
   */
  if (
    !receiptLink
  ) {

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
        fallback.nth(
          i
        );


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


  if (
    !receiptLink
  ) {

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


  const receiptBody =
    await getBodyText(
      p
    );


  console.log(
    'Receipt page contains 訪問看護:',
    receiptBody.includes(
      '訪問看護'
    )
  );


  if (
    !receiptBody.includes(
      '訪問看護'
    )
  ) {

    throw new Error(
      'レセプト情報画面に「訪問看護」が表示されませんでした。'
    );
  }


  /*
   * 訪問看護事業所を探す
   */
  console.log(
    'Searching visiting nursing office on receipt page...'
  );


  const nursingCandidates =
    p.getByText(
      /訪問看護/
    );


  const nursingCount =
    await nursingCandidates
      .count()
      .catch(
        () => 0
      );


  console.log(
    'Visiting nursing text candidate count:',
    nursingCount
  );


  let nursingLink =
    null;


  for (
    let i = 0;
    i < nursingCount;
    i++
  ) {

    const candidate =
      nursingCandidates
        .nth(
          i
        );


    const visible =
      await candidate
        .isVisible()
        .catch(
          () => false
        );


    if (!visible) {
      continue;
    }


    const tagName =
      await candidate
        .evaluate(
          el =>
            el.tagName
        )
        .catch(
          () => ''
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
     * 親a / button
     */
    const clickableParent =
      candidate
        .locator(
          'xpath=ancestor-or-self::a | ancestor-or-self::button'
        )
        .first();


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
     * onclick親
     */
    const onclickParent =
      candidate
        .locator(
          'xpath=ancestor-or-self::*[@onclick]'
        )
        .first();


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
   * aタグ直接検索
   */
  if (
    !nursingLink
  ) {

    console.log(
      'Trying direct anchor search...'
    );


    const directLinks =
      p.locator(
        'a'
      );


    const directCount =
      await directLinks
        .count();


    for (
      let i = 0;
      i < directCount;
      i++
    ) {

      const item =
        directLinks
          .nth(
            i
          );


      if (
        !(
          await item
            .isVisible()
            .catch(
              () => false
            )
        )
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


  if (
    !nursingLink
  ) {

    throw new Error(
      'レセプト情報画面から訪問看護事業所のリンクを検出できませんでした。'
    );
  }


  /*
   * 中身はログへ出さず
   * 有無だけ確認
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
   * 訪問看護システム確認
   */
  const nursingBody =
    await getBodyText(
      p
    );


  const isNursingSystem =

    /\/bizhnc\//i
      .test(
        p.url()
      )

    ||

    (
      nursingBody.includes(
        '各種情報出力'
      )

      &&

      nursingBody.includes(
        'スケジュール'
      )
    );


  if (
    !isNursingSystem
  ) {

    throw new Error(
      '訪問看護事業所を選択しましたが、訪問看護システムへ移動できませんでした。'
    );
  }


  console.log(
    '=== VISITING NURSING CONTEXT READY ==='
  );
}


/* =========================================================
   Open output selection page
========================================================= */

async function openOutputSelectionPage(
  p
) {

  console.log(
    '=== OPEN OUTPUT SELECTION START ==='
  );


  /*
   * 訪問看護コンテキストを作る
   */
  await openServiceSelectionPage(
    p
  );


  /*
   * すでに正しいページなら終了
   */
  if (
    isOutputSelectionUrl(
      p.url()
    )
  ) {

    const currentBody =
      await getBodyText(
        p
      );


    if (
      currentBody.includes(
        '看護記録書Ⅱ'
      )
    ) {

      console.log(
        'Already on correct output selection page'
      );


      console.log(
        '=== OPEN OUTPUT SELECTION SUCCESS ==='
      );


      return;
    }
  }


  /*
   * 各種情報出力
   */
  console.log(
    'Searching 各種情報出力...'
  );


  const outputCandidates = [

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
    of outputCandidates
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
        candidate.nth(
          i
        );


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


    if (
      outputMenu
    ) {

      break;
    }
  }


  if (
    !outputMenu
  ) {

    throw new Error(
      '訪問看護画面の「各種情報出力」を検出できませんでした。'
    );
  }


  /*
   * hover
   */
  console.log(
    'Hovering 各種情報出力...'
  );


  await outputMenu
    .hover();


  await p
    .waitForTimeout(
      700
    );


  /*
   * 出力対象選択
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


    for (
      let i = 0;
      i < count;
      i++
    ) {

      const item =
        candidate.nth(
          i
        );


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


    if (
      selectionLink
    ) {

      break;
    }
  }


  /*
   * hoverで出なければclick
   */
  if (
    !selectionLink
  ) {

    console.log(
      'Output submenu not visible after hover. Trying click...'
    );


    await outputMenu
      .click();


    await p
      .waitForTimeout(
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
        retry.nth(
          i
        );


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


  if (
    !selectionLink
  ) {

    throw new Error(
      '「各種情報出力」メニュー内の「出力対象選択」を検出できませんでした。'
    );
  }


  /*
   * context有無のみログ
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
    hrefInfo
      .hasConversationContext
  );


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


  const body =
    await getBodyText(
      p
    );


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

    throw new Error(
      '訪問看護の出力対象選択画面まで進みましたが、「看護記録書Ⅱ」が表示されませんでした。'
    );
  }


  console.log(
    '=== OPEN OUTPUT SELECTION SUCCESS ==='
  );
}


/* =========================================================
   Click 看護記録書Ⅱ
========================================================= */

async function clickRecord2(
  p
) {

  console.log(
    '=== CLICK 看護記録書Ⅱ START ==='
  );


  /*
   * 同名リンクが複数ある可能性がある。
   *
   * 非表示メニューではなく
   * visibleのものだけを使用。
   */
  const candidates =
    p.locator(
      'a'
    ).filter({
      hasText:
        '看護記録書Ⅱ'
    });


  const count =
    await candidates
      .count();


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
      candidates.nth(
        i
      );


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
   * aタグで見つからない場合
   */
  if (
    !recordLink
  ) {

    const textCandidates =
      p.getByText(
        '看護記録書Ⅱ',
        {
          exact:
            true
        }
      );


    const textCount =
      await textCandidates
        .count();


    console.log(
      '看護記録書Ⅱ text candidate count:',
      textCount
    );


    for (
      let i = 0;
      i < textCount;
      i++
    ) {

      const candidate =
        textCandidates
          .nth(
            i
          );


      if (
        !(
          await candidate
            .isVisible()
            .catch(
              () => false
            )
        )
      ) {

        continue;
      }


      const tagName =
        await candidate
          .evaluate(
            el =>
              el.tagName
          )
          .catch(
            () => ''
          );


      if (
        tagName === 'A'
      ) {

        recordLink =
          candidate;

        break;
      }


      const parentLink =
        candidate
          .locator(
            'xpath=ancestor-or-self::a'
          )
          .first();


      if (
        await parentLink
          .count()
          .catch(
            () => 0
          ) > 0
      ) {

        if (
          await parentLink
            .isVisible()
            .catch(
              () => false
            )
        ) {

          recordLink =
            parentLink;

          break;
        }
      }
    }
  }


  if (
    !recordLink
  ) {

    throw new Error(
      '表示中の「看護記録書Ⅱ」リンクを検出できませんでした。'
    );
  }


  /*
   * href / onclickの
   * 有無だけ確認
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
    Boolean(
      href
    )
  );


  console.log(
    'Visible 看護記録書Ⅱ has onclick:',
    Boolean(
      onclick
    )
  );


  console.log(
    'Clicking visible 看護記録書Ⅱ...'
  );


  await clickAndWait(
    p,
    recordLink,
    2000
  );


  await logCurrentPage(
    p,
    'AFTER RECORD2 CLICK'
  );


  const body =
    await getBodyText(
      p
    );


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

      (
        body.includes(
          'CSV出力'
        )

        ||

        body.includes(
          '出力条件'
        )
      )
    );


  console.log(
    'Export page detected:',
    looksLikeExportPage
  );


  if (
    !looksLikeExportPage
  ) {

    throw new Error(
      '「看護記録書Ⅱ」をクリックしましたが、出力条件設定画面へ移動できませんでした。'
    );
  }


  console.log(
    '=== CLICK 看護記録書Ⅱ SUCCESS ==='
  );
}


/* =========================================================
   Open 看護記録書Ⅱ export page
========================================================= */

async function openExportPage(
  p
) {

  console.log(
    '=== OPEN EXPORT PAGE START ==='
  );


  console.log(
    'START PATH:',
    safeUrlInfo(
      p.url()
    ).path
  );


  /*
   * すでに出力条件画面
   */
  if (
    isExportUrl(
      p.url()
    )
  ) {

    console.log(
      'Already on export page'
    );

    return;
  }


  /*
   * URLではなく画面内容でも確認
   */
  const initialBody =
    await getBodyText(
      p
    );


  if (
    initialBody.includes(
      '看護記録書Ⅱ'
    )

    &&

    initialBody.includes(
      'CSV出力'
    )
  ) {

    console.log(
      'Already on export page by body detection'
    );

    return;
  }


  /*
   * 1. ログイン
   */
  await autoLogin(
    p
  );


  /*
   * 2.
   * 訪問看護
   * ↓
   * 各種情報出力
   * ↓
   * 出力対象選択
   */
  await openOutputSelectionPage(
    p
  );


  /*
   * 3.
   * 看護記録書Ⅱ
   */
  await clickRecord2(
    p
  );


  /*
   * 最終確認
   */
  const body =
    await getBodyText(
      p
    );


  const exportReady =

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
    'EXPORT PAGE READY:',
    exportReady
  );


  if (
    !exportReady
  ) {

    throw new Error(
      '看護記録書Ⅱの出力条件画面まで移動できませんでした。'
    );
  }


  console.log(
    '=== OPEN EXPORT PAGE SUCCESS ==='
  );
}


/* =========================================================
   Japanese date
========================================================= */

function toJapaneseEra(
  dateString
) {

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/
      .exec(
        dateString
      );


  if (
    !match
  ) {

    throw new Error(
      '日付の変換に失敗しました。'
    );
  }


  const year =
    Number(
      match[1]
    );


  const month =
    Number(
      match[2]
    );


  const day =
    Number(
      match[3]
    );


  if (
    year < 2019
  ) {

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

    try {

      await select
        .selectOption({
          label:
            String(
              value
            )
        });


      return true;

    } catch {}


    try {

      await select
        .selectOption(
          String(
            value
          )
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
    await selects
      .count();


  console.log(
    'VISIBLE SELECT COUNT:',
    count
  );


  /*
   * 最初の「令和」selectを探す
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
        .nth(
          i
        )
        .locator(
          'option'
        )
        .allTextContents()
        .catch(
          () => []
        );


    const optionText =
      options.join(
        '|'
      );


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


  /*
   * 元号selectなし
   * 年月日 × 2
   */
  if (
    startIndex < 0
  ) {

    console.log(
      'Era select not found. Trying 6-select date format.'
    );


    if (
      count < 6
    ) {

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
        selects.nth(
          i
        );


      const success =
        await selectCandidate(
          target,
          [
            value,

            `${value}年`,

            `${value}月`,

            `${value}日`,

            String(
              value
            ),

            String(
              value
            ).padStart(
              2,
              '0'
            )
          ]
        );


      if (
        !success
      ) {

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
   * 元号 / 年 / 月 / 日 × 2
   */
  if (
    count <
    startIndex + 8
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

            String(
              value
            ),

            String(
              value
            ).padStart(
              2,
              '0'
            )

          ];


    const success =
      await selectCandidate(
        target,
        candidates
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
        `DATE SELECT ${i + 1}:`,
        options
          .slice(
            0,
            30
          )
          .join(
            '|'
          )
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

async function findCsvButton(
  p
) {

  /*
   * role=button
   */
  const roleButton =
    p.getByRole(
      'button',
      {
        name:
          /CSV出力/
      }
    )
    .last();


  if (
    await roleButton
      .count() > 0

    &&

    await roleButton
      .isVisible()
      .catch(
        () => false
      )
  ) {

    return roleButton;
  }


  /*
   * input submit
   */
  const submitButton =
    p.locator(
      'input[type="submit"][value*="CSV"]'
    )
    .last();


  if (
    await submitButton
      .count() > 0

    &&

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
    )
    .last();


  if (
    await normalButton
      .count() > 0

    &&

    await normalButton
      .isVisible()
      .catch(
        () => false
      )
  ) {

    return normalButton;
  }


  /*
   * 最終fallback
   */
  const text =
    p.getByText(
      'CSV出力',
      {
        exact:
          true
      }
    )
    .last();


  if (
    await text
      .count() > 0

    &&

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
  async (
    req,
    res
  ) => {

    try {

      const p =
        await getPage();


      res.json({

        running:
          true,

        loggedIn:
          await isLoggedIn(
            p
          ),

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
  async (
    req,
    res
  ) => {

    let p =
      null;


    try {

      console.log(
        '=== CONNECT START ==='
      );


      p =
        await getPage();


      console.log(
        'BEFORE LOGIN PATH:',
        safeUrlInfo(
          p.url()
        ).path
      );


      await autoLogin(
        p
      );


      await logCurrentPage(
        p,
        'AFTER LOGIN'
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
  async (
    req,
    res
  ) => {

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
          )

        ||

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
       * 1.
       * 看護記録書Ⅱ
       * 出力条件画面まで移動
       */
      await openExportPage(
        p
      );


      /*
       * 2.
       * 日付設定
       */
      await setExportDates(
        p,
        from,
        to
      );


      /*
       * 3.
       * CSV出力ボタン
       */
      const csvButton =
        await findCsvButton(
          p
        );


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
       * 4.
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


      await csvButton
        .click();


      console.log(
        'CSV button clicked'
      );


      const download =
        await downloadPromise;


      console.log(
        'Download event received'
      );


      /*
       * 5.
       * ダウンロード結果
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
        await download
          .path();


      if (
        !temporaryPath
      ) {

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
            .suggestedFilename()

          ||

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


      if (
        p
      ) {

        console.error(
          'PATH:',
          safeUrlInfo(
            p.url()
          ).path
        );


        console.error(
          'HAS CONTEXT:',
          safeUrlInfo(
            p.url()
          )
            .hasConversationContext
        );


        console.error(
          'TITLE:',
          await getSafeTitle(
            p
          )
        );
      }


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
