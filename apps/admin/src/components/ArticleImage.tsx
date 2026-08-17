import { useEffect, useMemo, useState } from 'react';

const API_URL = (import.meta.env.VITE_ADMIN_API_URL ?? '').replace(/\/$/, '');
const LOCAL_IMAGE_PATTERN = /^\/?(?:assets\/news_images|ft_images|news_images|images|downloaded_images)\/[a-z0-9_./%-]+\.(?:avif|gif|jpe?g|png|webp)$/i;

function displayImageUrl(value: string, sourceUrl: string) {
  const clean = value.trim().replace(/\\/g, '/');
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) {
    if (!/^https?:\/\//i.test(sourceUrl)) return '';
    const params = new URLSearchParams({ url: clean, source: sourceUrl });
    return `${API_URL}/api/image-proxy?${params.toString()}`;
  }
  if (!LOCAL_IMAGE_PATTERN.test(clean) || clean.split('/').includes('..')) return '';
  const localPath = clean.startsWith('/') ? clean : `/${clean}`;
  return `${API_URL}${localPath}`;
}

type ArticleImageProps = {
  imageUrl: string;
  sourceUrl: string;
  alt?: string;
  className?: string;
};

export function ArticleImage({ imageUrl, sourceUrl, alt = '', className = '' }: ArticleImageProps) {
  const src = useMemo(() => displayImageUrl(imageUrl, sourceUrl), [imageUrl, sourceUrl]);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  return (
    <span className={`article-image ${className} ${failed || !src ? 'is-fallback' : ''}`}>
      {!failed && src
        ? <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
        : <span className="article-image-fallback" role="img" aria-label={alt ? `${alt}: image unavailable` : 'Article image unavailable'}>CL</span>}
    </span>
  );
}
