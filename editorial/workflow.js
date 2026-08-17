'use strict';

/**
 * Editorial workflow policy shared by the local demo and Supabase stores.
 *
 * Generic status transitions are intentionally stricter than edit/rewrite
 * operations. In particular, a published article cannot be moved backwards by
 * calling transition(); a material edit must reopen it as changes_requested.
 */
const VALID_STATUSES = new Set([
  'scraped',
  'ai_processing',
  'pending_review',
  'changes_requested',
  'approved',
  'scheduled',
  'published',
  'rejected',
  'failed'
]);

const LEGAL_TRANSITIONS = Object.freeze({
  scraped: new Set(['ai_processing', 'pending_review', 'rejected', 'failed']),
  ai_processing: new Set(['pending_review', 'failed']),
  pending_review: new Set(['ai_processing', 'changes_requested', 'approved', 'rejected', 'failed']),
  changes_requested: new Set(['ai_processing', 'pending_review', 'approved', 'rejected', 'failed']),
  approved: new Set(['changes_requested', 'scheduled', 'published', 'rejected']),
  scheduled: new Set(['approved', 'changes_requested', 'published', 'rejected', 'failed']),
  published: new Set(),
  rejected: new Set(),
  failed: new Set(['ai_processing', 'pending_review', 'rejected'])
});

const APPROVABLE_STATUSES = new Set(['pending_review', 'changes_requested']);
const REJECTABLE_STATUSES = new Set([
  'scraped',
  'pending_review',
  'changes_requested',
  'approved',
  'scheduled',
  'failed'
]);
const REWRITABLE_STATUSES = new Set([
  'scraped',
  'pending_review',
  'changes_requested',
  'rejected',
  'failed'
]);

function canTransition(currentStatus, nextStatus) {
  if (!VALID_STATUSES.has(currentStatus) || !VALID_STATUSES.has(nextStatus)) return false;
  if (currentStatus === nextStatus) return true;
  return Boolean(LEGAL_TRANSITIONS[currentStatus]?.has(nextStatus));
}

function statusAfterEditorialEdit(currentStatus) {
  if (['approved', 'scheduled', 'published', 'rejected'].includes(currentStatus)) {
    return 'changes_requested';
  }
  if (['scraped', 'failed'].includes(currentStatus)) return 'pending_review';
  return currentStatus;
}

function transitionErrorMessage(currentStatus, nextStatus) {
  return `Illegal editorial workflow transition: ${currentStatus || 'unknown'} cannot move to ${nextStatus || 'unknown'}.`;
}

function rewriteErrorMessage(currentStatus) {
  if (['approved', 'scheduled', 'published'].includes(currentStatus)) {
    return `AI rewrite is not allowed while an article is ${currentStatus}. Edit it to reopen editorial review first.`;
  }
  if (currentStatus === 'ai_processing') return 'An AI rewrite is already in progress for this article.';
  return `AI rewrite is not allowed while an article is ${currentStatus || 'in an unknown state'}.`;
}

module.exports = {
  APPROVABLE_STATUSES,
  LEGAL_TRANSITIONS,
  REJECTABLE_STATUSES,
  REWRITABLE_STATUSES,
  VALID_STATUSES,
  canTransition,
  rewriteErrorMessage,
  statusAfterEditorialEdit,
  transitionErrorMessage
};
