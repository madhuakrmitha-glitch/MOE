import { useState } from 'react';
import { Check, Edit3, KeyRound, PlugZap, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { type Connection, type ProviderKind, providerLabel } from '../types';
import { Empty, ErrorNotice, Modal, Spinner } from './ui';

type Draft = Omit<Connection, 'id' | 'has_key'> & { api_key: string | null };
const defaults: Record<ProviderKind, string> = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434',
  huggingface: 'https://router.huggingface.co/v1',
};
export function Providers({
  workspaceId,
  connections,
  owner,
  refresh,
}: {
  workspaceId: string;
  connections: Connection[];
  owner: boolean;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState<Connection | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>({
    name: '',
    kind: 'openai',
    base_url: defaults.openai,
    api_key: null,
    token_parameter: 'max_tokens',
    supports_temperature: true,
    stream_enabled: true,
    include_usage: false,
  });
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [testModel, setTestModel] = useState(''),
    [testResult, setTestResult] = useState('');
  function open(connection: Connection | null) {
    setEditing(connection);
    setError('');
    setTestResult('');
    setDraft(
      connection
        ? {
            name: connection.name,
            kind: connection.kind,
            base_url: connection.base_url,
            api_key: null,
            token_parameter: connection.token_parameter,
            supports_temperature: connection.supports_temperature,
            stream_enabled: connection.stream_enabled,
            include_usage: connection.include_usage,
          }
        : {
            name: '',
            kind: 'openai',
            base_url: defaults.openai,
            api_key: null,
            token_parameter: 'max_tokens',
            supports_temperature: true,
            stream_enabled: true,
            include_usage: false,
          },
    );
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(
        editing ? `/connections/${editing.id}` : `/workspaces/${workspaceId}/connections`,
        editing ? 'PUT' : 'POST',
        draft,
      );
      setEditing(undefined);
      refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function remove(connection: Connection) {
    if (!confirm(`Delete ${connection.name}?`)) return;
    try {
      await api(`/connections/${connection.id}`, 'DELETE');
      refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  async function test() {
    if (!editing) return;
    setBusy(true);
    setError('');
    setTestResult('');
    try {
      await api(`/connections/${editing.id}/test`, 'POST', { model: testModel });
      setTestResult('Connection verified');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Workspace resources</span>
          <h1>Model connections</h1>
          <p>Connect a provider once. Choose a different model for every agent.</p>
        </div>
        {owner && (
          <button className="button primary" onClick={() => open(null)}>
            <Plus size={16} /> Add connection
          </button>
        )}
      </header>
      <ErrorNotice>{editing === undefined && error}</ErrorNotice>
      <div className="security-banner">
        <KeyRound size={19} />
        <div>
          <b>Credentials are managed on the server</b>
          <p>
            Keys are encrypted at rest and never returned to the browser. Workspace owners manage
            connections.
          </p>
        </div>
      </div>
      {!connections.length ? (
        <Empty
          title="Connect your first model provider"
          text="Use an OpenAI-compatible service, Ollama, or a Hugging Face endpoint."
          action={
            owner && (
              <button className="button secondary" onClick={() => open(null)}>
                <Plus size={15} /> Add connection
              </button>
            )
          }
        />
      ) : (
        <div className="provider-grid">
          {connections.map((connection) => (
            <article className="provider-card" key={connection.id}>
              <div className="provider-card-top">
                <span className={`provider-symbol ${connection.kind}`}>
                  <PlugZap size={20} />
                </span>
                <span className="badge">{providerLabel[connection.kind]}</span>
              </div>
              <h3>{connection.name}</h3>
              <p className="mono endpoint">{connection.base_url}</p>
              <div className="connection-meta">
                <span>
                  <i className={connection.has_key ? 'dot green' : 'dot'} />
                  {connection.has_key ? 'Credential stored' : 'No credential'}
                </span>
                <span>{connection.stream_enabled ? 'Streaming enabled' : 'Full responses'}</span>
              </div>
              {owner && (
                <footer>
                  <button className="text-button" onClick={() => open(connection)}>
                    <Edit3 size={13} /> Configure
                  </button>
                  <button
                    className="icon-button danger"
                    title="Delete connection"
                    onClick={() => remove(connection)}
                  >
                    <Trash2 size={14} />
                  </button>
                </footer>
              )}
            </article>
          ))}
        </div>
      )}
      {editing !== undefined && (
        <Modal
          title={editing ? 'Configure connection' : 'Add model connection'}
          subtitle="This connection can be reused by agents across your workspace."
          close={() => setEditing(undefined)}
        >
          <form onSubmit={save}>
            <div className="modal-body">
              <ErrorNotice>{error}</ErrorNotice>
              <label>
                Connection name
                <input
                  required
                  maxLength={100}
                  value={draft.name}
                  placeholder="e.g. Local Ollama or Research models"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                Provider type
                <select
                  value={draft.kind}
                  onChange={(e) => {
                    const kind = e.target.value as ProviderKind;
                    setDraft({ ...draft, kind, base_url: defaults[kind] });
                  }}
                >
                  {Object.entries(providerLabel).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Base URL
                <input
                  required
                  type="url"
                  maxLength={500}
                  value={draft.base_url}
                  onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
                />
                <small>
                  Use an allowed endpoint host. Hugging Face dedicated TGI endpoints can use their
                  /v1 base URL.
                </small>
              </label>
              <label>
                {editing?.has_key ? 'Replace API key (leave blank to keep)' : 'API key'}
                <input
                  type="password"
                  autoComplete="off"
                  value={draft.api_key ?? ''}
                  onChange={(e) => setDraft({ ...draft, api_key: e.target.value || null })}
                />
              </label>
              {editing?.has_key && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.api_key === ''}
                    onChange={(e) => setDraft({ ...draft, api_key: e.target.checked ? '' : null })}
                  />{' '}
                  Remove the stored credential
                </label>
              )}
              <details className="advanced">
                <summary>API compatibility options</summary>
                <label>
                  Output limit parameter
                  <select
                    value={draft.token_parameter}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        token_parameter: e.target.value as Draft['token_parameter'],
                      })
                    }
                  >
                    <option value="max_tokens">max_tokens</option>
                    <option value="max_completion_tokens">max_completion_tokens</option>
                  </select>
                  <small>
                    Choose the parameter your model accepts. Ollama uses native options.
                  </small>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.supports_temperature}
                    onChange={(e) => setDraft({ ...draft, supports_temperature: e.target.checked })}
                  />{' '}
                  Model accepts temperature
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.stream_enabled}
                    onChange={(e) => setDraft({ ...draft, stream_enabled: e.target.checked })}
                  />{' '}
                  Stream responses
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.include_usage}
                    onChange={(e) => setDraft({ ...draft, include_usage: e.target.checked })}
                  />{' '}
                  Request streaming token usage (if supported)
                </label>
              </details>
              {editing && (
                <div className="connection-test">
                  <label>
                    Test with a model
                    <input
                      value={testModel}
                      onChange={(e) => setTestModel(e.target.value)}
                      placeholder="Enter a supported model ID"
                    />
                  </label>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy || !testModel}
                    onClick={test}
                  >
                    <PlugZap size={14} /> Test saved connection
                  </button>
                  <small>Uses the saved settings and makes a small provider request.</small>
                  {testResult && (
                    <span className="success">
                      <Check size={14} />
                      {testResult}
                    </span>
                  )}
                </div>
              )}
            </div>
            <footer className="modal-footer">
              <button
                className="button secondary"
                type="button"
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? <Spinner /> : <Check size={15} />} Save connection
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
