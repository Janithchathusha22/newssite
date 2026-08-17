'use strict';

const LOCAL_IMAGE_DIRECTORIES = [
  'assets/news_images',
  'ft_images',
  'news_images',
  'images',
  'downloaded_images'
];

const PUBLISHER_HOST_SUFFIXES = [
  'ft.lk',
  'lankabusinessonline.com',
  'economynext.com',
  'adaderana.lk',
  'dailymirror.lk',
  'srilankabiz.lk',
  'businesstoday.lk',
  'cse.lk',
  'newsfirst.lk',
  'hirunews.lk',
  'news.lk',
  'caa.lk',
  'themorning.lk',
  'army.lk',
  'island.lk',
  'dailynews.lk',
  'srilankamirror.com',
  'news.cn',
  'sundayobserver.lk'
];

const ORACLE_IMAGE_HOSTS = new Map([
  ['ft.lk', new Set([
    'bmkltsly13vb.compat.objectstorage.ap-mumbai-1.oraclecloud.com'
  ])],
  ['dailymirror.lk', new Set([
    'bmkltsly13vb.compat.objectstorage.ap-singapore-1.oraclecloud.com'
  ])]
]);

const IMAGE_JUNK_MARKERS = [
  'data:image',
  'unsplash.com',
  'pexels.com',
  'pixabay.com',
  'dummyimage',
  'placeholder',
  'ftlk_logo_og',
  '/ft-logo.',
  '/logo.',
  '/logos/',
  '/icons/',
  '/sprite',
  '/emoji/',
  's.w.org/images/core/emoji',
  'loading.gif',
  'spacer.gif',
  'tracking-pixel',
  '/advert/',
  '/ads/'
];

function hostMatches(hostname, suffix) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  const cleanSuffix = String(suffix || '').toLowerCase().replace(/\.$/, '');
  return Boolean(host && cleanSuffix)
    && (host === cleanSuffix || host.endsWith(`.${cleanSuffix}`));
}

function publisherSuffix(hostname) {
  return PUBLISHER_HOST_SUFFIXES.find(suffix => hostMatches(hostname, suffix)) || '';
}

function parsePublisherUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return publisherSuffix(parsed.hostname) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function normalizeLocalImageUrl(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) return '';
  let value = rawValue.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  try {
    value = decodeURIComponent(value);
  } catch (_) {
    return '';
  }
  const parts = value.split('/').filter(part => part && part !== '.');
  if (!parts.length || parts.includes('..') || parts[0].includes(':')) return '';
  const normalized = parts.join('/');
  if (!LOCAL_IMAGE_DIRECTORIES.some(directory => (
    normalized.toLowerCase().startsWith(`${directory.toLowerCase()}/`)
  ))) return '';
  if (!/\.(?:avif|gif|jpe?g|png|webp)$/i.test(normalized)) return '';
  return `/${normalized}`;
}

function isPublisherImageUrl(image, source) {
  const publisher = publisherSuffix(source.hostname);
  if (!publisher) return false;
  if (hostMatches(image.hostname, publisher)) return true;

  if (ORACLE_IMAGE_HOSTS.get(publisher)?.has(image.hostname.toLowerCase())) return true;
  if (publisher === 'adaderana.lk') {
    const host = image.hostname.toLowerCase();
    if (host === 'ada-derana-prod-english-news-temp.s3.amazonaws.com') return true;
    if (host === 's3.amazonaws.com'
      && /^\/(?:bizenglish|bizsinhala)\/wp-content\/uploads\//i.test(image.pathname)) return true;
  }
  if (publisher === 'themorning.lk'
    && image.hostname.toLowerCase() === 'firebasestorage.googleapis.com'
    && /^\/v0\/b\/the-morning-39270\.appspot\.com\/o\/articles%2f/i.test(image.pathname)) {
    return true;
  }
  return false;
}

function normalizePublisherImageUrl(rawValue, sourceUrl) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) return '';
  const source = parsePublisherUrl(sourceUrl);
  if (!source) return '';
  try {
    const value = rawValue.trim();
    const image = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (!['http:', 'https:'].includes(image.protocol) || image.username || image.password) return '';
    const lower = image.href.toLowerCase();
    if (IMAGE_JUNK_MARKERS.some(marker => lower.includes(marker))) return '';
    if (image.pathname.toLowerCase().endsWith('.svg')) return '';
    if (!isPublisherImageUrl(image, source)) return '';
    image.hash = '';
    return image.href;
  } catch (_) {
    return '';
  }
}

function normalizeArticleImageUrl(rawValue, sourceUrl) {
  const local = normalizeLocalImageUrl(rawValue);
  if (local) return local;
  if (typeof rawValue !== 'string' || !rawValue.trim()) return '';
  try {
    const value = rawValue.trim();
    const image = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (!['http:', 'https:'].includes(image.protocol) || image.username || image.password) return '';
    const lower = image.href.toLowerCase();
    if (IMAGE_JUNK_MARKERS.some(marker => lower.includes(marker))) return '';
    if (image.pathname.toLowerCase().endsWith('.svg')) return '';
    image.hash = '';
    return image.href;
  } catch (_) {
    return normalizePublisherImageUrl(rawValue, sourceUrl);
  }
}

module.exports = {
  LOCAL_IMAGE_DIRECTORIES,
  PUBLISHER_HOST_SUFFIXES,
  hostMatches,
  normalizeArticleImageUrl,
  normalizeLocalImageUrl,
  normalizePublisherImageUrl,
  parsePublisherUrl,
  publisherSuffix
};
