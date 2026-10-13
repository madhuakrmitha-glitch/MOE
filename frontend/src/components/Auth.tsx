import { useEffect, useState } from 'react';
import { ArrowRight, ShieldCheck, Network, LockKeyhole } from 'lucide-react';
import { api, errorMessage } from '../api';
import type { User } from '../types';
import { ErrorNotice, Spinner } from './ui';

export function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [setup, setSetup] = useState({ bootstrap_available: false, registration_open: false });
  const invite = new URLSearchParams(window.location.search).get('invite');
  const [register, setRegister] = useState(Boolean(invite));
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    api<typeof setup>('/auth/setup')
      .then((value) => {
        setSetup(value);
        if (value.bootstrap_available) setRegister(true);
      })
      .catch((error) => setError(errorMessage(error)));
  }, []);
  const canRegister = setup.bootstrap_available || setup.registration_open || Boolean(invite);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = register
        ? { ...form, invite_token: invite }
        : { email: form.email, password: form.password };
      onLogin(await api<User>(register ? '/auth/register' : '/auth/login', 'POST', body));
      setForm({ name: '', email: '', password: '' });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <div className="brand">
          <div className="logo">m</div>
          <b>
            moe<span> / workspace</span>
          </b>
        </div>
        <div className="auth-story-main">
          <span className="eyebrow">A conversation with more perspective</span>
          <h1>
            Bring your
            <br />
            best minds
            <br />
            <em>into one room.</em>
          </h1>
          <p>
            Different models. Distinct points of view.
            <br />
            One shared space to think things through.
          </p>
          <div className="auth-personas">
            <AvatarIllustration name="AN" color="#c4cbbd" />
            <AvatarIllustration name="CR" color="#debab0" />
            <AvatarIllustration name="SY" color="#b8bdd6" />
            <span>Built for thoughtful collaboration</span>
          </div>
        </div>
        <footer>
          <span>
            <ShieldCheck size={14} /> Protected provider keys
          </span>
          <span>
            <Network size={14} /> Multiple model providers
          </span>
        </footer>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-inner">
          <span className="eyebrow">
            {setup.bootstrap_available
              ? 'Set up your workspace'
              : invite
                ? 'You have an invitation'
                : 'Your agent workspace'}
          </span>
          <h2>{register ? 'Create your account' : 'Welcome back'}</h2>
          <p>
            {register
              ? 'Start with an account. Then connect your models and build a room.'
              : 'Sign in to pick up the conversation.'}
          </p>
          <ErrorNotice>{error}</ErrorNotice>
          <form onSubmit={submit}>
            {register && (
              <label>
                Name
                <input
                  required
                  maxLength={100}
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                aria-label="Password"
                required
                minLength={12}
                maxLength={128}
                autoComplete={register ? 'new-password' : 'current-password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              {register && <small>At least 12 characters</small>}
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  {register ? 'Create account' : 'Sign in'}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
          {canRegister && (
            <button className="text-button auth-toggle" onClick={() => setRegister(!register)}>
              {register ? 'Already have an account? Sign in' : 'Need an account? Create one'}
            </button>
          )}
          <p className="auth-trust">
            <LockKeyhole size={13} /> Your API credentials stay encrypted on the server.
          </p>
        </div>
      </section>
    </div>
  );
}
function AvatarIllustration({ name, color }: { name: string; color: string }) {
  return (
    <span className="auth-persona" style={{ background: color }}>
      {name}
    </span>
  );
}
