import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useNewsroom } from '../state/NewsroomContext';

export function LoginPage() {
  const { session, login, loginDemo, demoEnabled } = useNewsroom();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [persistent, setPersistent] = useState(true);

  if (session) return <Navigate to="/dashboard" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password, persistent);
      navigate('/dashboard');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  const useDemo = async () => {
    setBusy(true);
    setError('');
    try {
      await loginDemo(persistent);
      navigate('/dashboard');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start demo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-visual">
        <div className="login-visual-overlay" />
        <div className="login-brand"><span className="brand-mark brand-mark-light">BL</span><strong>Business Leaders Sri Lanka</strong></div>
        <div className="login-quote">
          <span className="eyebrow light">One source of editorial truth</span>
          <h1>Publish with<br />confidence.</h1>
          <p>A careful newsroom workflow for source-grounded AI drafts, human review and responsible publication.</p>
          <div className="login-flow">
            <div><i>1</i><span>Collect</span></div><b />
            <div><i>2</i><span>Rewrite</span></div><b />
            <div><i>3</i><span>Review</span></div><b />
            <div><i>4</i><span>Publish</span></div>
          </div>
        </div>
        <small>Protected editorial environment · Sri Lanka</small>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="eyebrow">Editorial access</span>
          <h2>Welcome to Newsroom</h2>
          <p className="login-intro">Click below to enter the editorial dashboard and review today’s stories.</p>
          
          {error && <div className="form-error"><Icon name="warning" size={17} />{error}</div>}

          <button className="button button-primary button-full" type="button" onClick={() => void useDemo()} disabled={busy}>
            {busy ? <><span className="button-spinner" />Opening Newsroom…</> : <><Icon name="sparkles" size={18} /> Open Demo Newsroom <Icon name="arrow-right" size={18} /></>}
          </button>
          
          <p className="demo-note" style={{ marginTop: '16px', textAlign: 'center' }}>
            Instant demo access. Explore the editorial workflow, article queues, and published newsroom.
          </p>
        </div>
      </section>
    </main>
  );
}
