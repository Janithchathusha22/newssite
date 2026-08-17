'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}/api`;

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 12_000);
    const inspect = chunk => {
      if (String(chunk).includes('Proxy Server running')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.on('exit', code => reject(new Error(`Server exited early (${code})`)));
  });
}

async function request(pathname, options = {}) {
  const response = await fetch(`${BASE}${pathname}`, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function homeArticleIds(home) {
  return new Set([
    ...(home.topNews || []),
    ...(home.latest || []),
    ...Object.values(home.sections || {}).flat()
  ].map(article => article.id));
}

async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTO_SYNC_ENABLED: 'false',
      NODE_ENV: 'test',
      ADMIN_EMAIL: 'editor@example.com',
      ADMIN_PASSWORD: '',
      ADMIN_PASSWORD_HASH: 'scrypt$00112233445566778899aabbccddeeff$8d9b6329d6a5d5d2ffe5c2d68ecf35b2dfb37158d2fcdb6468af6e8c5ede98a0a48c9f22fc1da5782f05c30cc3427f560011fd30f45e8b1db4a8b6652ee944f4',
      ADMIN_SESSION_SECRET: 'test-session-secret-that-is-long-enough',
      PREVIEW_TOKEN_SECRET: 'test-preview-secret-that-is-long-enough',
      GROQ_API_KEY: '',
      EDITORIAL_BACKEND: 'local',
      EDITORIAL_STORE_PERSIST: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  try {
    await waitForServer(child);
    const home = await request('/public/home');
    assert.strictEqual(home.topNews.length, 10);
    assert.ok(home.latest.every(article => article.slug && article.sourceName));

    const login = await request('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'editor@example.com', password: 'test-password' })
    });
    assert.ok(login.token);
    assert.strictEqual(login.demo, false, 'a successful API login must not become a browser demo session');
    assert.strictEqual(login.user.role, 'admin');
    assert.ok(Date.parse(login.expiresAt) > Date.now(), 'the client needs an explicit session expiry');
    await assert.rejects(
      () => request('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'incorrect' })
      }),
      /401:/,
      'invalid credentials must not produce a demo session'
    );
    const headers = { Authorization: `Bearer ${login.token}` };
    const pending = await request('/admin/articles?status=pending_review', { headers });
    assert.ok(pending.articles.length > 0);

    const preview = await request(`/admin/articles/${pending.articles[0].id}/preview-token`, {
      method: 'POST', headers
    });
    const previewPayload = await request(`/preview/${preview.token}`);
    assert.strictEqual(previewPayload.article.preview, true);

    const rewritable = pending.articles.find(article => article.original.body);
    assert.ok(rewritable);
    const rejectedCandidate = pending.articles.find(article => article.id !== rewritable.id);
    assert.ok(rejectedCandidate);

    await assert.rejects(
      () => request(`/public/articles/${rewritable.slug}`),
      /404:/,
      'pending articles must not be readable through the public detail API'
    );
    assert.strictEqual(homeArticleIds(await request('/public/home')).has(rewritable.id), false);
    const pendingCategory = await request(`/public/categories/${rewritable.category}`);
    assert.strictEqual(pendingCategory.articles.some(article => article.id === rewritable.id), false);

    const rejected = await request(`/admin/articles/${rejectedCandidate.id}/reject`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Rejected by the API visibility integration test.' })
    });
    assert.strictEqual(rejected.article.status, 'rejected');
    await assert.rejects(
      () => request(`/public/articles/${rejectedCandidate.slug}`),
      /404:/,
      'rejected articles must not be readable through the public detail API'
    );

    const rewritten = await request(`/admin/articles/${rewritable.id}/rewrite`, {
      method: 'POST', headers
    });
    assert.strictEqual(rewritten.article.status, 'pending_review');

    const published = await request(`/admin/articles/${rewritable.id}/approve`, {
      method: 'POST', headers
    });
    assert.strictEqual(published.article.status, 'published');
    assert.ok(Date.parse(published.article.publishedAt), 'approval must set the website publication time');
    const publicDetail = await request(`/public/articles/${published.article.slug}`);
    assert.strictEqual(publicDetail.article.id, rewritable.id);
    assert.strictEqual(Object.hasOwn(publicDetail.article, 'original'), false);
    assert.strictEqual(homeArticleIds(await request('/public/home')).has(rewritable.id), true);
    const publishedCategory = await request(`/public/categories/${published.article.category}`);
    assert.strictEqual(publishedCategory.articles.some(article => article.id === rewritable.id), true);

    const rejectedHome = await request('/public/home');
    assert.strictEqual(homeArticleIds(rejectedHome).has(rejectedCandidate.id), false);
    const rejectedCategory = await request(`/public/categories/${rejectedCandidate.category}`);
    assert.strictEqual(rejectedCategory.articles.some(article => article.id === rejectedCandidate.id), false);

    const noOpSave = await request(`/admin/articles/${rewritable.id}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.strictEqual(noOpSave.article.status, 'published', 'an empty save must not reopen publication');

    await assert.rejects(
      () => request(`/admin/articles/${rewritable.id}/approve`, { method: 'POST', headers }),
      /409:/,
      'the API must reject published-to-approved'
    );
    await assert.rejects(
      () => request(`/admin/articles/${rewritable.id}/reject`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'This action must not silently unpublish a live story.' })
      }),
      /409:/,
      'the API must reject published-to-rejected'
    );
    await assert.rejects(
      () => request(`/admin/articles/${rewritable.id}/rewrite`, { method: 'POST', headers }),
      /409:/,
      'the API must reject AI regeneration of a published version'
    );

    const correctedHeadline = `${published.article.draft.headline} — editor correction`;
    const reopened = await request(`/admin/articles/${rewritable.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: { headline: correctedHeadline } })
    });
    assert.strictEqual(reopened.article.status, 'changes_requested');
    await assert.rejects(
      () => request(`/public/articles/${published.article.slug}`),
      /404:/,
      'a materially edited live story must leave the public feed until it is reapproved'
    );
    const reapproved = await request(`/admin/articles/${rewritable.id}/approve`, {
      method: 'POST', headers
    });
    assert.strictEqual(reapproved.article.status, 'published');
    const correctedPublicDetail = await request(`/public/articles/${published.article.slug}`);
    assert.strictEqual(correctedPublicDetail.article.headline, correctedHeadline);

    console.log('Editorial API integration tests passed.');
  } finally {
    child.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
