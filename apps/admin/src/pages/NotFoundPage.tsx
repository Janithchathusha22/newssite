import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';

export function NotFoundPage() {
  return <main className="standalone-not-found"><div className="brand-mark">CL</div><span className="eyebrow">404 · Page not found</span><h1>This page missed the deadline.</h1><p>The address may have changed, or the newsroom page is no longer available.</p><Link className="button button-primary" to="/dashboard"><Icon name="arrow-left" size={17} />Return to dashboard</Link></main>;
}
