import express from 'express';
import { chromium } from 'playwright';
import fs from 'fs';

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

if (!SECRET) {
  throw new Error('BRIDGE_SECRET is required');
}

const app = express();

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  if (req.get('X-Bridge-Secret') !== SECRET) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  next();
});

let context = null;


/* =========================
   Browser
========================= */

async function ctx() {

  if (!context) {

    fs.mkdirSync(PROFILE, {
      recursive: true
    });

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


async function page() {

  const c = await ctx();

  return (
    c.pages()[0] ||
    await c.newPage()
  );
}


/* =========================
   Kaipoke helpers
========================= */

function isKaipoke(u = '') {

  try {

    return /(^|\.)kaipoke\.biz$/i.test(
      new URL(u).hostname
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


async function loggedIn(p) {

  const u = p.url();

  if (!isKaipoke(u)) {
    return false;
  }

  const t = await bodyText(p);

  const loginPage =
    /法人ID|ユーザーID|パスワード/.test(t);

  return (
    !loginPage ||
    /ログアウト/.test(t)
  );
}


/* =========================
   Kaipoke login
========================= */

async function autoLogin(p) {

  if (!isKaipoke(p.url())) {

    await p.goto(
      'https://r.kaipoke.biz/kaipokebiz/login/COM020102.do',
      {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      }
    );
  }


  if (await loggedIn(p)) {
    return true;
  }


  if (
    !KP_CORPORATE_ID ||
    !KP_USER_ID ||
    !KP_PASS
  ) {

    throw new Error(
      'カイポケの法人ID・ユーザーID・パスワードが設定されていません。'
    );
  }


  const textInputs =
    p.locator(
      'input[type="text"]:visible'
    );

  const textCount =
    await textInputs.count();


  if (textCount < 2) {

    throw new Error(
      'カイポケの法人ID・ユーザーID入力欄を検出できませんでした。'
    );
  }


  /*
   * カイポケログイン画面
   *
   * 1番目 = 法人ID
   * 2番目 = ユーザーID
   */

  await textInputs
    .nth(0)
    .fill(KP_CORPORATE_ID);

  await textInputs
    .nth(1)
    .fill(KP_USER_ID);


  const passwordInput =
    p.locator(
      'input[type="password"]:visible'
    ).first();


  if (!(await passwordInput.count())) {

    throw new Error(
      'カイポケのパスワード入力欄を検出できませんでした。'
    );
  }


  await passwordInput.fill(KP_PASS);


  /*
   * ログインボタン
   */

  const loginButton =
    p.getByText(
      'ログイン',
      { exact: true }
    ).last();


  if (await loginButton.count()) {

    await loginButton.click();

  } else {

    const submit =
      p.locator(
        'input[type="submit"]'
      ).first();

    if (!(await submit.count())) {

      throw new Error(
        'カイポケのログインボタンを検出できませんでした。'
      );
    }

    await submit.click();
  }


  await p
    .waitForLoadState(
      'domcontentloaded',
      { timeout: 60000 }
    )
    .catch(() => {});


  await p.waitForTimeout(1500);


  if (!(await loggedIn(p))) {

    throw new Error(
      'カイポケへ自動ログインできませんでした。ID・パスワード、追加認証、ログイン画面の変更をご確認ください。'
    );
  }


  return true;
}


/* =========================
   Date
========================= */

function era(d) {

  const x =
    new Date(
      d + 'T00:00:00'
    );

  return {

    era: '令和',

    year:
      x.getFullYear() - 2018,

    month:
      x.getMonth() + 1,

    day:
      x.getDate()
  };
}


async function choose(
  sel,
  candidates
) {

  for (const v of candidates) {

    try {

      await sel.selectOption({
        label: String(v)
      });

      return true;

    } catch {}


    try {

      await sel.selectOption(
        String(v)
      );

      return true;

    } catch {}
  }

  return false;
}


/* =========================
   Export date settings
========================= */

async function setDates(
  p,
  from,
  to
) {

  const all =
    p.locator(
      'select:visible'
    );

  const n =
    await all.count();


  if (n < 6) {

    throw new Error(
      '訪問日の選択欄を検出できません。'
    );
  }


  const a = era(from);
  const b = era(to);

  const meta = [];


  for (
    let i = 0;
    i < n;
    i++
  ) {

    meta.push(
      (
        await all
          .nth(i)
          .locator('option')
          .allTextContents()
      ).join('|')
    );
  }


  let start =
    meta.findIndex(
      x => x.includes('令和')
    );


  if (start < 0) {
    start = 0;
  }


  const hasEra =
    meta[start]?.includes('令和');


  const vals =
    hasEra

      ? [
          a.era,
          a.year,
          a.month,
          a.day,
          b.era,
          b.year,
          b.month,
          b.day
        ]

      : [
          a.year,
          a.month,
          a.day,
          b.year,
          b.month,
          b.day
        ];


  for (
    let j = 0;
    j < vals.length;
    j++
  ) {

    const v = vals[j];


    const ok =
      await choose(
        all.nth(start + j),
        [
          v,
          `${v}年`,
          `${v}月`,
          `${v}日`,
          String(v)
            .padStart(2, '0')
        ]
      );


    if (!ok) {

      throw new Error(
        `日付欄(${j + 1})を設定できませんでした。`
      );
    }
  }
}


/* =========================
   Open export screen
========================= */

async function openExport(p) {

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
   * メニューを順番に探索
   */

  for (
    const label of [
      '訪問看護',
      '各種帳票',
      '看護記録書Ⅱ'
    ]
  ) {

    const a =
      p.getByText(
        label,
        { exact: false }
      ).first();


    if (
      await a.count() &&
      await a
        .isVisible()
        .catch(() => false)
    ) {

      await a.click();


      await p
        .waitForLoadState(
          'domcontentloaded',
          {
            timeout: 30000
          }
        )
        .catch(() => {});


      await p.waitForTimeout(
        500
      );
    }
  }


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
      '看護記録書Ⅱの出力画面へ自動移動できませんでした。KAIPOKE_EXPORT_URL の設定が必要です。'
    );
  }
}


/* =========================
   API
========================= */

app.get(
  '/health',
  (req, res) => {

    res.json({
      ok: true
    });
  }
);


app.get(
  '/status',
  async (req, res) => {

    try {

      const p =
        await page();

      res.json({

        running: true,

        loggedIn:
          await loggedIn(p)

      });

    } catch (e) {

      res
        .status(500)
        .json({
          error: e.message
        });
    }
  }
);


app.post(
  '/connect',
  async (req, res) => {

    try {

      const p =
        await page();

      await autoLogin(p);


      res.json({

        ok: true,

        loggedIn: true,

        message:
          'カイポケへ接続しました。'

      });

    } catch (e) {

      res
        .status(500)
        .json({
          error: e.message
        });
    }
  }
);


app.post(
  '/export',
  async (req, res) => {

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
              '日付が不正です'
          });
      }


      const p =
        await page();


      await autoLogin(p);

      await openExport(p);

      await setDates(
        p,
        from,
        to
      );


      const btn =
        p.getByText(
          'CSV出力',
          { exact: true }
        ).last();


      const dlP =
        p.waitForEvent(
          'download',
          {
            timeout: 60000
          }
        );


      await btn.click();


      const dl =
        await dlP;


      const tmp =
        await dl.path();


      if (!tmp) {

        throw new Error(
          'CSVを取得できませんでした。'
        );
      }


      const buf =
        fs.readFileSync(tmp);


      res.json({

        ok: true,

        filename:
          dl.suggestedFilename() ||
          `看護記録書Ⅱ_${from}-${to}.csv`,

        csvBase64:
          buf.toString('base64')

      });


    } catch (e) {

      res
        .status(500)
        .json({

          error:
            e.message ||
            '取得に失敗しました'

        });
    }
  }
);


/* =========================
   Start
========================= */

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `Kaipoke bridge server listening on ${PORT}`
    );
  }
);
