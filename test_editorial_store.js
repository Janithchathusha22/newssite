'use strict';

const assert = require('assert');
const { EditorialStore, categoryFor, createInitialState, publicArticle } = require('./editorial/store');

assert.strictEqual(categoryFor({
  title: 'Hayleys delivers strong Q1 performance with PBT up 61%',
  summary: 'Revenue and profit increased during the June quarter.',
  full_text: 'The chairman welcomed the results.'
}), 'money', 'an incidental chairman quote must not turn an earnings report into an appointment');
assert.strictEqual(categoryFor({
  title: 'SriLankan Airlines confirms new chairman',
  summary: 'The appointment was confirmed today.'
}), 'interviews-appointments');

const store = new EditorialStore({ persist: false });
store.state = createInitialState();

const published = store.listArticles({ status: 'published' });
assert.ok(published.length >= 10, 'demo state should provide a public homepage');
assert.strictEqual(store.getTopNews().length, 10, 'home page must expose ten ranked stories');
for (const domain of ['dailymirror.lk', 'adaderana.lk', 'newsfirst.lk', 'hirunews.lk', 'ft.lk', 'economynext.com', 'lankabusinessonline.com', 'businesstoday.lk', 'news.lk']) {
  assert.ok(store.listSources().some(source => source.domain === domain), `source catalog should include ${domain}`);
}

const pending = store.listArticles({ status: 'pending_review' })[0];
assert.ok(pending, 'scraped/curated stories should enter review');
const updated = store.updateArticle(pending.id, {
  draft: { headline: 'Editorially reviewed headline' },
  category: 'business-news'
}, 'test-editor');
assert.strictEqual(updated.draft.headline, 'Editorially reviewed headline');
assert.strictEqual(updated.category, 'business-news');

const publicRecord = publicArticle(published[0]);
assert.ok(publicRecord.slug);
assert.ok(publicRecord.sourceName);
assert.strictEqual(Object.hasOwn(publicRecord, 'original'), false, 'public API must not leak raw drafts');

assert.throws(
  () => store.setTopNews([pending.id], 'test-editor'),
  /published articles only/
);

const lifecycleStore = new EditorialStore({ persist: false });
lifecycleStore.state = createInitialState();
const liveStory = lifecycleStore.listArticles({ status: 'published' })[0];
assert.ok(liveStory, 'the workflow test needs a published story');

assert.throws(
  () => lifecycleStore.transition(liveStory.id, 'approved', 'test-editor'),
  error => error.statusCode === 409 && error.code === 'ILLEGAL_WORKFLOW_TRANSITION',
  'a published story must never move directly back to approved'
);
assert.throws(
  () => lifecycleStore.transition(liveStory.id, 'rejected', 'test-editor'),
  error => error.statusCode === 409 && error.code === 'ILLEGAL_WORKFLOW_TRANSITION',
  'reject must not act as an implicit unpublish operation'
);

const unchangedLiveStory = lifecycleStore.updateArticle(liveStory.id, {}, 'test-editor');
assert.strictEqual(unchangedLiveStory.status, 'published', 'an empty save must not reopen a live story');

const reopened = lifecycleStore.updateArticle(liveStory.id, {
  draft: { headline: `${liveStory.draft.headline} — corrected` }
}, 'test-editor');
assert.strictEqual(reopened.status, 'changes_requested', 'a material live edit must reopen review');
assert.strictEqual(reopened.topRank, null, 'a reopened live story must leave Top News');
assert.strictEqual(lifecycleStore.transition(reopened.id, 'approved', 'test-editor').status, 'approved');
assert.strictEqual(lifecycleStore.transition(reopened.id, 'published', 'test-editor').status, 'published');

assert.throws(
  () => lifecycleStore.replaceDraft(liveStory.id, { headline: 'Unsafe rewrite' }, {}, 'groq-worker'),
  error => error.statusCode === 409 && error.code === 'ILLEGAL_REWRITE_STATUS',
  'AI regeneration must not overwrite a published editorial version'
);

const rejectedStore = new EditorialStore({ persist: false });
rejectedStore.state = createInitialState();
const rejectedCandidate = rejectedStore.listArticles({ status: 'pending_review' })[0];
rejectedStore.transition(rejectedCandidate.id, 'rejected', 'test-editor', 'Needs a fresh draft');
const editedRejected = rejectedStore.updateArticle(rejectedCandidate.id, {
  draft: { summary: 'A revised summary for another editorial review.' }
}, 'test-editor');
assert.strictEqual(editedRejected.status, 'changes_requested', 'editing a rejected story must reopen review');
assert.strictEqual(editedRejected.rejectionReason, '', 'a reopened story must clear its active rejection reason');

const rewrittenRejectedCandidate = rejectedStore.listArticles({ status: 'pending_review' })[0];
rejectedStore.transition(rewrittenRejectedCandidate.id, 'rejected', 'test-editor', 'Regenerate it');
const rewrittenRejected = rejectedStore.replaceDraft(rewrittenRejectedCandidate.id, {
  headline: 'Fact-preserving regenerated headline',
  summary: 'Fact-preserving regenerated summary',
  body: rewrittenRejectedCandidate.original.body
}, {}, 'groq-worker');
assert.strictEqual(rewrittenRejected.status, 'pending_review', 'rewriting a rejected story must return it to review');

console.log('Editorial store tests passed.');
