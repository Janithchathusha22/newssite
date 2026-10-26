import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { useNewsroom } from '../state/NewsroomContext';

export function LinkedInPage() {
  const {
    getLinkedInStatus,
    saveLinkedInConfig,
    testLinkedInPost,
    connectLinkedIn,
    articles,
  } = useNewsroom();
  const { notify } = useToast();

  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingPost, setTestingPost] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Status state
  const [status, setStatus] = useState<{
    connected: boolean;
    authMode?: 'playwright_bot' | 'official_api' | 'none';
    email: string;
    hasApiKeys?: boolean;
    hasAccessToken?: boolean;
    maskedClientId?: string;
    organizationId?: string;
    autoPublishTopNews?: boolean;
    enginePreference?: 'auto' | 'api' | 'bot';
  }>({
    connected: false,
    email: 'altrixx99@gmail.com',
  });

  // API Credentials Form
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [enginePreference, setEnginePreference] = useState<'auto' | 'api' | 'bot'>('auto');
  const [autoPublishTopNews, setAutoPublishTopNews] = useState(true);

  // Test Post Form
  const [testHeadline, setTestHeadline] = useState('Central Bank of Sri Lanka Holds Policy Rates Steady as Inflation Moderates');
  const [testSummary, setTestSummary] = useState('The Monetary Policy Board maintained the Standing Deposit Facility Rate and Standing Lending Facility Rate, supporting economic growth trajectory.');
  const [testUrl, setTestUrl] = useState('https://businessleaders.lk');

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await getLinkedInStatus();
      setStatus(res);
      if (res.organizationId) setOrganizationId(res.organizationId);
      if (res.autoPublishTopNews !== undefined) setAutoPublishTopNews(res.autoPublishTopNews);
      if (res.enginePreference) setEnginePreference(res.enginePreference);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to fetch LinkedIn status', 'danger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
  }, []);

  const handleConnectBrowser = async () => {
    setConnecting(true);
    try {
      const res = await connectLinkedIn(status.email);
      notify(res.message);
      // Poll status after a short delay
      setTimeout(() => void fetchStatus(), 5000);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not launch browser login', 'danger');
    } finally {
      setConnecting(false);
    }
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const res = await saveLinkedInConfig({
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
        accessToken: accessToken.trim() || undefined,
        organizationId: organizationId.trim() || undefined,
        autoPublishTopNews,
        enginePreference,
      });
      notify(res.message || 'LinkedIn credentials saved successfully.');
      setClientSecret('');
      await fetchStatus();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save LinkedIn configuration', 'danger');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTestPost = async () => {
    setTestingPost(true);
    setTestResult(null);
    try {
      const res = await testLinkedInPost({
        headline: testHeadline.trim(),
        summary: testSummary.trim(),
        sourceUrl: testUrl.trim(),
      });
      setTestResult(`[Success ${res.timestamp || new Date().toLocaleTimeString()}]: ${res.message}`);
      notify('Test post published to LinkedIn successfully!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test post failed';
      setTestResult(`[Error]: ${msg}`);
      notify(msg, 'danger');
    } finally {
      setTestingPost(false);
    }
  };

  const postedArticles = articles.filter(a => a.editorNote?.includes('Shared to LinkedIn'));

  return (
    <div className="panel" style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px' }}>
      {/* HEADER BANNER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', paddingBottom: '20px', borderBottom: '1px solid var(--border-color, #2a2a2a)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(10, 102, 194, 0.15)', color: '#0a66c2' }}>
              <Icon name="linkedin" size={22} />
            </span>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 600 }}>LinkedIn Automation Hub</h1>
          </div>
          <p style={{ margin: '6px 0 0', color: 'var(--text-secondary, #888)', fontSize: '14px' }}>
            Multi-channel social media publishing engine for Business Leaders &amp; Ceylon Ledger.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '13px',
            fontWeight: 500,
            background: status.connected ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            color: status.connected ? '#22c55e' : '#ef4444',
            border: `1px solid ${status.connected ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: status.connected ? '#22c55e' : '#ef4444' }} />
            {status.connected
              ? (status.authMode === 'official_api' ? 'Active: Official API' : 'Active: Playwright Bot')
              : 'Disconnected'}
          </span>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void fetchStatus()}
            disabled={loading}
            title="Refresh connection status"
          >
            <Icon name="refresh" size={15} />
            {loading ? 'Checking…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '24px', marginTop: '24px' }}>
        {/* CARD A: PLAYWRIGHT BOT (ACTIVE NOW) */}
        <div style={{ background: 'var(--card-bg, #1e1e1e)', border: '1px solid var(--border-color, #333)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>🤖</span>
              <strong style={{ fontSize: '16px' }}>Personal Profile Bot (Playwright)</strong>
            </div>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '2px 8px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}>
              Instant Mode
            </span>
          </div>

          <p style={{ fontSize: '13px', color: 'var(--text-secondary, #aaa)', lineHeight: 1.5, margin: '0 0 16px' }}>
            Allows immediate news distribution directly to your personal LinkedIn profile (<strong>{status.email}</strong>). Requires zero Company Page verification and zero developer approval.
          </p>

          <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary, #888)' }}>Target Account:</span>
              <strong>{status.email}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary, #888)' }}>Session Storage:</span>
              <code>linkedin_session.json</code>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary, #888)' }}>Engine Status:</span>
              <span style={{ color: status.connected ? '#22c55e' : '#f59e0b' }}>
                {status.connected ? '✓ Session Saved & Ready' : '⚠ Login Required'}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="button button-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={connecting}
            onClick={handleConnectBrowser}
          >
            {connecting ? <span className="button-spinner" /> : <Icon name="external" size={16} />}
            Launch 1-Time Browser Sign-In
          </button>
          <small style={{ display: 'block', textAlign: 'center', marginTop: '8px', color: 'var(--text-secondary, #777)', fontSize: '12px' }}>
            A browser will pop up. Enter your password once to authenticate.
          </small>
        </div>

        {/* CARD B: OFFICIAL LINKEDIN DEVELOPER API */}
        <div style={{ background: 'var(--card-bg, #1e1e1e)', border: '1px solid var(--border-color, #333)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>🏢</span>
              <strong style={{ fontSize: '16px' }}>Official LinkedIn REST API</strong>
            </div>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '2px 8px', borderRadius: '4px', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' }}>
              Company Page Ready
            </span>
          </div>

          <p style={{ fontSize: '13px', color: 'var(--text-secondary, #aaa)', lineHeight: 1.5, margin: '0 0 16px' }}>
            For official company broadcasts once LinkedIn allows Company Page creation (in 2-3 days). Configure your LinkedIn App credentials here:
          </p>

          <form onSubmit={handleSaveCredentials} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary, #bbb)' }}>
                Client ID (App ID)
              </label>
              <input
                type="text"
                placeholder={status.maskedClientId || 'e.g. 78a9xxxxxxxxxx'}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #444', background: '#111', color: '#fff', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary, #bbb)' }}>
                <span>Client Secret</span>
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '11px', padding: 0 }}
                >
                  {showSecret ? 'Hide' : 'Show'}
                </button>
              </label>
              <input
                type={showSecret ? 'text' : 'password'}
                placeholder="Enter client secret"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #444', background: '#111', color: '#fff', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary, #bbb)' }}>
                Access Token (Bearer OAuth 2.0)
              </label>
              <textarea
                rows={2}
                placeholder={status.hasAccessToken ? '•••••••••••••••••••••••• (Token configured)' : 'AQX... (Paste 60-day access token)'}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #444', background: '#111', color: '#fff', fontSize: '13px', resize: 'vertical' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary, #bbb)' }}>
                Organization URN (Company ID)
              </label>
              <input
                type="text"
                placeholder="e.g. urn:li:organization:12345678"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #444', background: '#111', color: '#fff', fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary, #bbb)' }}>
                  Engine Mode
                </label>
                <select
                  value={enginePreference}
                  onChange={(e) => setEnginePreference(e.target.value as 'auto' | 'api' | 'bot')}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #444', background: '#111', color: '#fff', fontSize: '13px' }}
                >
                  <option value="auto">Auto (Official API if set, else Bot)</option>
                  <option value="api">Official API Only</option>
                  <option value="bot">Playwright Bot Only</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={savingConfig}
                >
                  {savingConfig ? <span className="button-spinner" /> : <Icon name="save" size={16} />}
                  Save API Keys
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* CARD C: AUTOMATION POLICY */}
      <div style={{ background: 'var(--card-bg, #1e1e1e)', border: '1px solid var(--border-color, #333)', borderRadius: '12px', padding: '20px', marginTop: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>⚡</span>
              <strong style={{ fontSize: '16px' }}>Daily Auto-Pilot Distribution (Top 5 Business News)</strong>
            </div>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary, #aaa)', fontSize: '13px', maxWidth: '700px' }}>
              When enabled, the automated daily scraper enriches the top 5 Business &amp; Economy stories and instantly publishes them directly to the Business Leaders public page and dispatches them to LinkedIn without waiting for manual editorial clicks.
            </p>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '10px 16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
            <input
              type="checkbox"
              checked={autoPublishTopNews}
              onChange={async (e) => {
                const nextVal = e.target.checked;
                setAutoPublishTopNews(nextVal);
                await saveLinkedInConfig({ autoPublishTopNews: nextVal });
                notify(`Auto-publish top 5 news is now ${nextVal ? 'enabled' : 'disabled'}.`);
              }}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <span style={{ fontWeight: 600, fontSize: '14px' }}>Auto-Dispatch Top 5 Active</span>
          </label>
        </div>
      </div>

      {/* CARD D: INSTANT TEST POST CONSOLE */}
      <div style={{ background: 'var(--card-bg, #1e1e1e)', border: '1px solid var(--border-color, #333)', borderRadius: '12px', padding: '20px', marginTop: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <span style={{ fontSize: '18px' }}>🧪</span>
          <strong style={{ fontSize: '16px' }}>Instant Test Post Console</strong>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary, #bbb)' }}>
              Test Headline
            </label>
            <input
              type="text"
              value={testHeadline}
              onChange={(e) => setTestHeadline(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #444', background: '#111', color: '#fff', fontSize: '13px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary, #bbb)' }}>
              Target Article URL
            </label>
            <input
              type="text"
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #444', background: '#111', color: '#fff', fontSize: '13px' }}
            />
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary, #bbb)' }}>
            Post Caption / Summary
          </label>
          <textarea
            rows={3}
            value={testSummary}
            onChange={(e) => setTestSummary(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #444', background: '#111', color: '#fff', fontSize: '13px' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <button
            type="button"
            className="button button-primary"
            disabled={testingPost}
            onClick={handleTestPost}
          >
            {testingPost ? <span className="button-spinner" /> : <Icon name="linkedin" size={16} />}
            Send Test Post to LinkedIn Now
          </button>

          {testResult && (
            <span style={{ fontSize: '13px', color: testResult.startsWith('[Success') ? '#22c55e' : '#ef4444' }}>
              {testResult}
            </span>
          )}
        </div>
      </div>

      {/* CARD E: RECENTLY DISPATCHED ARTICLES */}
      <div style={{ background: 'var(--card-bg, #1e1e1e)', border: '1px solid var(--border-color, #333)', borderRadius: '12px', padding: '20px', marginTop: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>📋</span>
            <strong style={{ fontSize: '16px' }}>Recently Dispatched to LinkedIn ({postedArticles.length})</strong>
          </div>
        </div>

        {postedArticles.length === 0 ? (
          <p style={{ color: 'var(--text-secondary, #888)', fontSize: '13px', fontStyle: 'italic', margin: 0 }}>
            No articles have been shared to LinkedIn yet. Approve an article or use the test console above to dispatch your first post.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {postedArticles.slice(0, 8).map(art => (
              <div key={art.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', fontSize: '13px' }}>
                <span style={{ fontWeight: 500, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {art.draft.headline || art.original.headline}
                </span>
                <span style={{ color: '#22c55e', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Icon name="check" size={14} /> Shared
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
