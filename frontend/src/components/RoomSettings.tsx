import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Save, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { type Agent, type Connection, type Room, type RoomConfig, modeLabel } from '../types';
import { Avatar, ErrorNotice, Modal, Spinner } from './ui';

const personas = {
  Analyst:
    'Analyze evidence, assumptions, and trade-offs. Make concrete recommendations and flag uncertainty.',
  Challenger:
    'Challenge assumptions constructively. Look for alternatives, blind spots, and failure modes.',
  Synthesizer:
    'Connect the strongest ideas from the group. Identify agreement, unresolved issues, and clear next steps.',
};
const colors = ['#6d78d5', '#b88163', '#5e9a8d', '#a175b7', '#c38b45'];
export function roomConfig(room: Room): RoomConfig {
  return {
    title: room.title,
    revision: room.revision,
    shared_prompt: room.shared_prompt,
    mode: room.mode,
    rounds: room.rounds,
    max_turns: room.max_turns,
    context_messages: room.context_messages,
    failure_policy: room.failure_policy,
    moderator_id: room.moderator_id,
    agents: room.agents.map((a) => ({
      id: a.id,
      name: a.name,
      connection_id: a.connection_id,
      model: a.model,
      system_prompt: a.system_prompt,
      enabled: a.enabled,
      temperature: a.temperature,
      max_tokens: a.max_tokens,
      color: a.color,
    })),
  };
}
export function RoomSettings({
  room,
  connections,
  close,
  saved,
}: {
  room: Room;
  connections: Connection[];
  close: () => void;
  saved: () => void;
}) {
  const [draft, setDraft] = useState<RoomConfig>(roomConfig(room)),
    [tab, setTab] = useState('agents');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const patch = (values: Partial<RoomConfig>) =>
    setDraft((previous) => ({ ...previous, ...values }));
  const patchAgent = (id: string, values: Partial<Agent>) =>
    patch({ agents: draft.agents.map((a) => (a.id === id ? { ...a, ...values } : a)) });
  function freshAgent(number: number): Agent {
    return {
      id: crypto.randomUUID(),
      name: `Agent ${number}`,
      connection_id: connections[0]?.id || '',
      model: '',
      system_prompt: 'Contribute a helpful and distinct perspective.',
      enabled: true,
      temperature: 0.7,
      max_tokens: 1024,
      color: colors[(number - 1) % colors.length],
    };
  }
  function resize(count: number) {
    const next = Math.max(0, Math.min(16, count));
    patch({ agents: Array.from({ length: next }, (_, i) => draft.agents[i] || freshAgent(i + 1)) });
  }
  function move(index: number, offset: number) {
    const list = [...draft.agents];
    const target = index + offset;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    patch({ agents: list });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/rooms/${room.id}`, 'PUT', draft);
      saved();
      close();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Room configuration"
      subtitle="Give every agent a role, then set the rules for the conversation."
      close={close}
      wide
    >
      <form onSubmit={save}>
        <div className="modal-tabs">
          <button
            type="button"
            className={tab === 'agents' ? 'selected' : ''}
            onClick={() => setTab('agents')}
          >
            Agents <span>{draft.agents.length}</span>
          </button>
          <button
            type="button"
            className={tab === 'policy' ? 'selected' : ''}
            onClick={() => setTab('policy')}
          >
            Conversation policy
          </button>
        </div>
        <div className="modal-body">
          <ErrorNotice>{error}</ErrorNotice>
          <label>
            Room name
            <input
              required
              maxLength={120}
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </label>
          {tab === 'agents' ? (
            <>
              <div className="section-line">
                <div>
                  <h3>Agent roster</h3>
                  <p>
                    Each agent has its own model and instructions. Order controls round-robin turns.
                  </p>
                </div>
                <label className="count-input">
                  Agents
                  <input
                    aria-label="Number of agents"
                    type="number"
                    min={0}
                    max={16}
                    value={draft.agents.length}
                    disabled={!connections.length}
                    onChange={(e) => resize(Number(e.target.value))}
                  />
                </label>
              </div>
              {!connections.length && (
                <div className="info-notice">
                  Add a provider connection before configuring agents.
                </div>
              )}
              <div className="agent-editor-list">
                {draft.agents.map((agent, index) => (
                  <details className="agent-editor" key={agent.id} open={index === 0}>
                    <summary>
                      <Avatar name={agent.name} color={agent.color} />
                      <span>
                        <b>{agent.name}</b>
                        <small>
                          {agent.model || 'Choose a model'} · {agent.enabled ? 'Enabled' : 'Paused'}
                        </small>
                      </span>
                      <span className="agent-order">{String(index + 1).padStart(2, '0')}</span>
                    </summary>
                    <div className="agent-editor-body">
                      <div className="field-grid">
                        <label>
                          Agent name
                          <input
                            required
                            maxLength={60}
                            value={agent.name}
                            onChange={(e) => patchAgent(agent.id, { name: e.target.value })}
                          />
                        </label>
                        <label>
                          Provider connection
                          <select
                            value={agent.connection_id}
                            required
                            onChange={(e) =>
                              patchAgent(agent.id, { connection_id: e.target.value })
                            }
                          >
                            {connections.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Model name or ID
                          <input
                            required
                            maxLength={200}
                            value={agent.model}
                            placeholder="e.g. llama3.2 or a provider model ID"
                            onChange={(e) => patchAgent(agent.id, { model: e.target.value })}
                          />
                        </label>
                        <label>
                          Quick persona
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              const name = e.target.value as keyof typeof personas;
                              if (name) patchAgent(agent.id, { system_prompt: personas[name] });
                            }}
                          >
                            <option value="">Custom instructions</option>
                            {Object.keys(personas).map((p) => (
                              <option key={p}>{p}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label>
                        Individual system prompt
                        <textarea
                          rows={4}
                          maxLength={20000}
                          value={agent.system_prompt}
                          onChange={(e) => patchAgent(agent.id, { system_prompt: e.target.value })}
                        />
                      </label>
                      <div className="field-grid three">
                        <label>
                          Temperature
                          <input
                            type="number"
                            min={0}
                            max={2}
                            step={0.1}
                            value={agent.temperature}
                            onChange={(e) =>
                              patchAgent(agent.id, { temperature: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Output token limit
                          <input
                            type="number"
                            min={16}
                            max={8192}
                            value={agent.max_tokens}
                            onChange={(e) =>
                              patchAgent(agent.id, { max_tokens: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Avatar color
                          <input
                            type="color"
                            value={agent.color}
                            onChange={(e) => patchAgent(agent.id, { color: e.target.value })}
                          />
                        </label>
                      </div>
                      <div className="agent-editor-actions">
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={agent.enabled}
                            onChange={(e) => patchAgent(agent.id, { enabled: e.target.checked })}
                          />{' '}
                          Enabled in this room
                        </label>
                        <span>
                          <button
                            type="button"
                            className="icon-button"
                            title="Move up"
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title="Move down"
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title="Duplicate agent"
                            disabled={draft.agents.length >= 16}
                            onClick={() =>
                              patch({
                                agents: [
                                  ...draft.agents,
                                  {
                                    ...agent,
                                    id: crypto.randomUUID(),
                                    name: `${agent.name} copy`.slice(0, 60),
                                  },
                                ],
                              })
                            }
                          >
                            <Copy size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button danger"
                            title="Remove agent"
                            onClick={() =>
                              patch({ agents: draft.agents.filter((a) => a.id !== agent.id) })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </span>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
              <button
                type="button"
                className="button secondary full"
                disabled={!connections.length || draft.agents.length >= 16}
                onClick={() => resize(draft.agents.length + 1)}
              >
                <Plus size={15} /> Add an agent
              </button>
            </>
          ) : (
            <>
              <label>
                Shared system prompt
                <textarea
                  rows={6}
                  maxLength={20000}
                  value={draft.shared_prompt}
                  onChange={(e) => patch({ shared_prompt: e.target.value })}
                />
                <small>
                  Sets the topic, goals, and rules for every participant, including the moderator.
                </small>
              </label>
              <div className="field-grid">
                <label>
                  Interaction pattern
                  <select
                    value={draft.mode}
                    onChange={(e) => patch({ mode: e.target.value as RoomConfig['mode'] })}
                  >
                    {Object.entries(modeLabel).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.mode === 'round_robin' && (
                  <label>
                    Rounds
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={draft.rounds}
                      onChange={(e) => patch({ rounds: Number(e.target.value) })}
                    />
                  </label>
                )}
                {draft.mode === 'moderated' && (
                  <label>
                    Moderator agent
                    <select
                      required
                      value={draft.moderator_id || ''}
                      onChange={(e) => patch({ moderator_id: e.target.value })}
                    >
                      <option value="">Choose an agent</option>
                      {draft.agents
                        .filter((a) => a.enabled)
                        .map((a) => (
                          <option value={a.id} key={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label>
                  Maximum agent turns
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={draft.max_turns}
                    onChange={(e) => patch({ max_turns: Number(e.target.value) })}
                  />
                </label>
                <label>
                  History messages in context
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.context_messages}
                    onChange={(e) => patch({ context_messages: Number(e.target.value) })}
                  />
                </label>
                <label>
                  If an agent fails
                  <select
                    value={draft.failure_policy}
                    onChange={(e) =>
                      patch({ failure_policy: e.target.value as 'continue' | 'stop' })
                    }
                  >
                    <option value="continue">Continue with other agents</option>
                    <option value="stop">Stop the discussion</option>
                  </select>
                </label>
              </div>
              <div className="info-notice">
                Turn limits and each agent's output token cap bound a discussion. In moderated mode,
                the moderator also makes a selection request before each turn.
              </div>
            </>
          )}
        </div>
        <footer className="modal-footer">
          <span>Changes apply to the next run.</span>
          <button className="button secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : <Save size={15} />} Save configuration
          </button>
        </footer>
      </form>
    </Modal>
  );
}
