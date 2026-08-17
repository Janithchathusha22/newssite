import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { useNewsroom } from '../state/NewsroomContext';

const validDate = (date?: string) => Boolean(date && Number.isFinite(Date.parse(date)));
const formatTime = (date?: string) => validDate(date)
  ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(date as string))
  : 'Not collected';

const formatStatusTime = (date?: string | null) => validDate(date ?? undefined)
  ? new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date as string))
  : 'Not yet';

export function SourcesPage() {
  const {
    sources,
    toggleSource,
    loading,
    collectionState,
    refresh,
    refreshCollectionStatus,
    runCollection,
  } = useNewsroom();
  const { notify } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);

  useEffect(() => {
    if (!collectionState?.running || collectionState.mode !== 'remote') return undefined;

    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const next = await refreshCollectionStatus();
        if (cancelled) return;
        if (next.mode === 'demo') {
          notify('Live collection status is temporarily unavailable.', 'neutral');
          return;
        }
        if (!next.running) {
          await refresh();
          notify(
            next.lastExitCode === 0 ? 'Publisher collection completed.' : 'Publisher collection finished with an error.',
            next.lastExitCode === 0 ? 'success' : 'danger',
          );
          return;
        }
      } catch {
        if (!cancelled) notify('Could not refresh collection progress.', 'danger');
        return;
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 4000);
    };

    timer = window.setTimeout(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [collectionState?.mode, collectionState?.running, notify, refresh, refreshCollectionStatus]);

  const toggle = async (id: string, enabled: boolean) => {
    setBusyId(id);
    try {
      await toggleSource(id, enabled);
      notify(
        enabled
          ? 'Source enabled for the next publisher collection.'
          : 'Source paused for the next publisher collection.',
        enabled ? 'success' : 'neutral',
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update source.', 'danger');
    } finally {
      setBusyId(null);
    }
  };

  const startCollection = async () => {
    setCollecting(true);
    try {
      const result = await runCollection();
      if (result.simulated) {
        notify('Demo simulation only — no publisher scraper was started.', 'neutral');
      } else if (result.started) {
        notify('Publisher collection started. Progress will update here.', 'success');
      } else if (result.reason === 'already_running') {
        notify('A publisher collection is already running.', 'neutral');
      } else {
        notify('Collection is disabled on the server.', 'danger');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not start publisher collection.', 'danger');
    } finally {
      setCollecting(false);
    }
  };

  const stats = {
    healthy: sources.filter((source) => source.status === 'healthy').length,
    attention: sources.filter((source) => source.status === 'attention').length,
    today: sources.reduce((sum, source) => sum + source.articlesToday, 0),
    average: sources.length ? sources.reduce((sum, source) => sum + source.successRate, 0) / sources.length : 0,
  };

  const collectionTone = collectionState?.mode === 'demo'
    ? 'demo'
    : collectionState?.running
      ? 'running'
      : collectionState && (!collectionState.enabled || collectionState.lastError)
        ? 'attention'
        : 'ready';
  const collectionTitle = collectionState?.mode === 'demo'
    ? 'Demo collection control'
    : collectionState?.running
      ? 'Publisher collection in progress'
      : collectionState && !collectionState.enabled
        ? 'Automatic collection is disabled'
        : collectionState?.lastError
          ? 'Last collection needs attention'
          : 'Collection service ready';
  const collectionDescription = collectionState?.mode === 'demo'
    ? 'This screen uses local sample data. Running collection only demonstrates the control; it does not contact publishers.'
    : collectionState?.running
      ? `Started ${formatStatusTime(collectionState.lastStartedAt)}${collectionState.lastTrigger ? ` · ${collectionState.lastTrigger.replace('-', ' ')}` : ''}. Status refreshes automatically.`
      : collectionState?.lastError
        ? collectionState.lastError
        : 'Start the protected scraper pipeline now, or leave the scheduler to run it automatically.';
  const collectionDisabled = collecting
    || Boolean(collectionState?.running)
    || (collectionState?.mode === 'remote' && collectionState.enabled === false);

  return (
    <div className="sources-page">
      <section className="source-summary-grid">
        <div className="source-stat"><span className="source-health-dot healthy" /><div><strong>{stats.healthy}</strong><span>Healthy records</span></div></div>
        <div className="source-stat"><span className="source-health-dot attention" /><div><strong>{stats.attention}</strong><span>Need attention</span></div></div>
        <div className="source-stat"><Icon name="articles" /><div><strong>{stats.today}</strong><span>Collected today</span></div></div>
        <div className="source-stat"><Icon name="published" /><div><strong>{stats.average.toFixed(1)}%</strong><span>Average success</span></div></div>
      </section>
      <section className="panel source-table-panel">
        <div className="panel-heading source-panel-heading">
          <div><span className="eyebrow">Publisher registry</span><h2>Automated sources</h2><p>Registered publishers and observed feed health. Each switch controls whether that publisher adapter runs during the next collection.</p></div>
          <button
            type="button"
            className="button button-primary source-run-button"
            disabled={collectionDisabled}
            onClick={() => void startCollection()}
          >
            {collecting ? <span className="button-spinner" /> : <Icon name="refresh" size={16} className={collectionState?.running ? 'spin' : ''} />}
            {collecting ? 'Starting…' : collectionState?.running ? 'Running…' : 'Run collection'}
          </button>
        </div>
        <div className={`collection-status collection-status-${collectionTone}`} aria-live="polite">
          <span className="collection-status-icon">
            <Icon
              name={collectionTone === 'attention' ? 'warning' : collectionTone === 'ready' ? 'check' : collectionTone === 'demo' ? 'info' : 'refresh'}
              size={18}
              className={collectionState?.running ? 'spin' : ''}
            />
          </span>
          <div className="collection-status-copy">
            <strong>{collectionState ? collectionTitle : 'Checking collection service…'}</strong>
            <span>{collectionState ? collectionDescription : 'Loading protected scheduler status.'}</span>
          </div>
          {collectionState && (
            <div className="collection-status-meta">
              <span><small>Last success</small>{collectionState.mode === 'demo' ? 'Demo only' : formatStatusTime(collectionState.lastSucceededAt)}</span>
              <span><small>{collectionState.mode === 'demo' ? 'Sample records' : 'Feed records'}</small>{collectionState.feed.articleCount}</span>
              <span><small>Next run</small>{collectionState.mode === 'demo' ? 'Not scheduled' : formatStatusTime(collectionState.nextRunAt)}</span>
            </div>
          )}
        </div>
        <div className="source-table-wrap">
          <table className="source-table"><thead><tr><th>Source</th><th>Group</th><th>Health</th><th>Today</th><th>Success</th><th>Last collection</th><th>Collect</th></tr></thead><tbody>{sources.map((source) => <tr key={source.id}><td><div className="publisher-cell"><span>{source.name.slice(0, 2).toUpperCase()}</span><div><strong>{source.name}</strong><small>{source.domain}</small></div></div>{source.error && <div className={`source-error ${source.status}`}><Icon name={source.status === 'attention' ? 'warning' : 'info'} size={13} />{source.error}</div>}</td><td><span className="group-chip">{source.group}</span></td><td><span className={`health-label health-${source.status}`}><i />{source.status === 'attention' ? 'Attention' : source.status === 'paused' ? 'Inactive' : 'Healthy'}</span></td><td><strong>{source.articlesToday}</strong></td><td><span className="success-rate"><i><b style={{ width: `${source.successRate}%` }} /></i>{source.successRate.toFixed(1)}%</span></td><td><span className="source-time">{formatTime(source.lastRunAt)}<small>{validDate(source.nextRunAt) ? `Next ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(source.nextRunAt))}` : source.enabled ? 'Awaiting first collection' : 'Paused by administrator'}</small></span></td><td><label className={`switch ${busyId === source.id ? 'switch-busy' : ''}`} title="Include this publisher in the next collection"><input type="checkbox" aria-label={`${source.name} collection status`} checked={source.enabled} disabled={busyId === source.id} onChange={(event) => void toggle(source.id, event.target.checked)} /><span /></label></td></tr>)}</tbody></table>
        </div>
        {loading && !sources.length && <div className="table-loading"><span className="button-spinner dark" />Loading source health…</div>}
      </section>
    </div>
  );
}
