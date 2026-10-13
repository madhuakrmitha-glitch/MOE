import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  MessageSquare,
  Send,
  Settings2,
  Square,
  Trash2,
  Wand2,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, downloadJson, errorMessage } from '../api';
import { useRoom } from '../hooks/useRoom';
import { type Connection, type Message, type Room, type Run, modeLabel } from '../types';
import { Avatar, Empty, ErrorNotice, Spinner } from './ui';
import { RoomSettings } from './RoomSettings';

export function Conversation({
  id,
  connections,
  writable,
  changed,
  deleted,
}: {
  id: string;
  connections: Connection[];
  writable: boolean;
  changed: () => void;
  deleted: () => void;
}) {
  const { room, error, active, partials, reconnecting, reload, loadEarlier } = useRoom(id);
  const [settings, setSettings] = useState(false),
    [text, setText] = useState(''),
    [target, setTarget] = useState('');
  const [sending, setSending] = useState(false),
    [sendError, setSendError] = useState('');
  const request = useRef<{ text: string; id: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true);
  useEffect(() => {
    setText('');
    setSendError('');
    setSettings(false);
    setTarget('');
    nearBottom.current = true;
  }, [id]);
  useEffect(() => {
    if (nearBottom.current) bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [room?.messages.length, partials.map((p) => p.text.length).join(',')]);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || active || sending) return;
    setSending(true);
    setSendError('');
    const content = text.trim();
    if (!request.current || request.current.text !== content)
      request.current = { text: content, id: crypto.randomUUID() };
    try {
      await api<Run>(`/rooms/${id}/runs`, 'POST', {
        text: content,
        request_id: request.current.id,
        target_agent_id: target || null,
      });
      setText('');
      request.current = null;
      await reload();
      changed();
    } catch (error) {
      setSendError(errorMessage(error));
    } finally {
      setSending(false);
    }
  }
  async function stop() {
    if (!active) return;
    try {
      await api(`/runs/${active.id}/cancel`, 'POST');
      await reload();
    } catch (error) {
      setSendError(errorMessage(error));
    }
  }
  async function remove() {
    if (!confirm('Delete this room and its conversation history?')) return;
    try {
      await api(`/rooms/${id}`, 'DELETE');
      deleted();
    } catch (error) {
      setSendError(errorMessage(error));
    }
  }
  async function exportRoom() {
    try {
      const data = await api(`/rooms/${id}/export`);
      downloadJson(data, `moe-${id}.json`);
    } catch (error) {
      setSendError(errorMessage(error));
    }
  }
  if (error)
    return (
      <div className="page">
        <ErrorNotice>{error}</ErrorNotice>
        <button className="button secondary" onClick={reload}>
          Try again
        </button>
      </div>
    );
  if (!room)
    return (
      <div className="loading">
        <Spinner /> Loading room
      </div>
    );
  const enabled = room.agents.filter((a) => a.enabled);
  const lastRun = room.runs[0];
  return (
    <div className="conversation-layout">
      <section className="conversation">
        <header className="conversation-header">
          <div>
            <div className="breadcrumb">
              Conversations <ChevronRight size={12} /> Room
            </div>
            <h1>{room.title}</h1>
            <div className="conversation-subtitle">
              <span className="dot green" />
              {enabled.length} active {enabled.length === 1 ? 'agent' : 'agents'}
              <span>·</span>
              {modeLabel[room.mode]}
            </div>
          </div>
          <div className="header-actions">
            <button className="icon-button" title="Export conversation" onClick={exportRoom}>
              <ArrowDownToLine size={17} />
            </button>
            {writable && (
              <>
                <button
                  className="icon-button danger"
                  title="Delete room"
                  disabled={Boolean(active)}
                  onClick={remove}
                >
                  <Trash2 size={16} />
                </button>
                <button className="button secondary" onClick={() => setSettings(true)}>
                  <Settings2 size={15} /> Configure
                </button>
              </>
            )}
          </div>
        </header>
        <div
          className="chat-scroll"
          ref={scroll}
          onScroll={() => {
            const node = scroll.current;
            if (node)
              nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
          }}
        >
          <div className="messages">
            {room.messages[0]?.sequence > 1 && (
              <button
                className="text-button load-earlier"
                onClick={() => loadEarlier().catch((error) => setSendError(errorMessage(error)))}
              >
                Load earlier messages
              </button>
            )}
            {!room.messages.length ? (
              <Empty
                title="A fresh room. A wider perspective."
                text={
                  enabled.length
                    ? 'Set a topic for the group. Every agent will follow the room instructions and bring its own point of view.'
                    : 'Connect a model provider, add your agents, and set the rules for a productive discussion.'
                }
                action={
                  writable && !enabled.length ? (
                    <button className="button primary" onClick={() => setSettings(true)}>
                      <Settings2 size={15} /> Set up agents
                    </button>
                  ) : (
                    <div className="starter-grid">
                      {[
                        'Pressure-test a product idea',
                        'Compare two technical approaches',
                        'Explore a topic from different perspectives',
                        'Build a practical action plan',
                      ].map((prompt) => (
                        <button key={prompt} disabled={!writable} onClick={() => setText(prompt)}>
                          <Wand2 size={14} />
                          {prompt}
                        </button>
                      ))}
                    </div>
                  )
                }
              />
            ) : (
              room.messages.map((message) => (
                <MessageCard message={message} room={room} key={message.id} />
              ))
            )}
            {partials.map((partial) => (
              <article className="message-row" key={partial.turn_id}>
                <Avatar
                  name={partial.name}
                  color={room.agents.find((a) => a.id === partial.agent_id)?.color}
                />
                <div className="message-content">
                  <div className="message-heading">
                    <b>{partial.name}</b>
                    <span className="streaming-label">
                      <Spinner /> thinking
                    </span>
                  </div>
                  <div className="markdown">
                    <Markdown remarkPlugins={[remarkGfm]}>{partial.text || ' '}</Markdown>
                    <span className="cursor" />
                  </div>
                </div>
              </article>
            ))}
            <div ref={bottom} />
          </div>
        </div>
        <div className="composer-area">
          <ErrorNotice>{sendError}</ErrorNotice>
          {lastRun &&
            !active &&
            ['failed', 'cancelled', 'interrupted', 'completed_with_errors'].includes(
              lastRun.status,
            ) && (
              <div className="run-notice">
                <span className="badge">{lastRun.status}</span>
                <span>{lastRun.error}</span>
                {writable && (
                  <button className="text-button" onClick={() => setText(lastRun.input_text)}>
                    Use prompt again
                  </button>
                )}
              </div>
            )}
          {reconnecting && (
            <div className="info-notice">
              Reconnecting to live updates. The server keeps the discussion running.
            </div>
          )}
          {active && (
            <div className="run-progress">
              <span>
                <Spinner />
                {active.status === 'queued'
                  ? 'Waiting for a worker'
                  : active.status === 'cancel_requested'
                    ? 'Stopping discussion…'
                    : 'Agents are discussing'}
                <small className="mono">{active.id.slice(0, 8)}</small>
              </span>
              {writable && (
                <button
                  className="text-button danger"
                  onClick={stop}
                  disabled={active.status === 'cancel_requested'}
                >
                  <Square size={12} /> Stop
                </button>
              )}
            </div>
          )}
          <form className="composer" onSubmit={send}>
            <textarea
              placeholder={
                !writable
                  ? 'You have view-only access to this workspace'
                  : !enabled.length
                    ? 'Configure your agents to start a conversation'
                    : 'Message the group. Give them a topic, a question, or an idea…'
              }
              aria-label="Message the group"
              value={text}
              disabled={!writable || !enabled.length}
              maxLength={20000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="composer-bottom">
              <span>
                <MessageSquare size={13} />
                <select
                  aria-label="Message recipients"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Everyone in the room</option>
                  {enabled.map((a) => (
                    <option value={a.id} key={a.id}>
                      Only {a.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </span>
              <button
                className="button primary"
                disabled={
                  sending || Boolean(active) || !writable || !enabled.length || !text.trim()
                }
              >
                {sending ? <Spinner /> : <Send size={15} />} Send
              </button>
            </div>
          </form>
          <p className="composer-footnote">
            Enter to send · Shift + Enter for a new line{' '}
            <span>Model responses may contain mistakes.</span>
          </p>
        </div>
      </section>
      <aside className="room-inspector">
        <div className="inspector-heading">
          <span className="eyebrow">In this room</span>
          <span className="badge">
            {room.agents.length} {room.agents.length === 1 ? 'agent' : 'agents'}
          </span>
        </div>
        {room.agents.map((agent) => (
          <article className={`roster-card ${!agent.enabled ? 'paused' : ''}`} key={agent.id}>
            <div>
              <Avatar name={agent.name} color={agent.color} />
              <span>
                <b>{agent.name}</b>
                <small>
                  {connections.find((c) => c.id === agent.connection_id)?.name ||
                    'Provider connection'}
                </small>
              </span>
              <span className={`dot ${agent.enabled ? 'green' : ''}`} />
            </div>
            <p className="mono">{agent.model}</p>
            <p className="roster-prompt">{agent.system_prompt}</p>
            <span className="roster-cap">
              {agent.max_tokens.toLocaleString()} output tokens max
              {room.moderator_id === agent.id && ' · Moderator'}
            </span>
          </article>
        ))}
        {!room.agents.length && <p className="muted">Your configured agents appear here.</p>}
        <div className="inspector-policy">
          <span className="eyebrow">Shared instructions</span>
          <p>{room.shared_prompt}</p>
          <dl>
            <div>
              <dt>Pattern</dt>
              <dd>{modeLabel[room.mode]}</dd>
            </div>
            <div>
              <dt>Turn limit</dt>
              <dd>{room.max_turns}</dd>
            </div>
            <div>
              <dt>On failure</dt>
              <dd>{room.failure_policy === 'continue' ? 'Continue' : 'Stop'}</dd>
            </div>
          </dl>
        </div>
        {room.runs.length > 0 && (
          <div className="inspector-runs">
            <span className="eyebrow">Recent runs</span>
            {room.runs.slice(0, 5).map((run) => (
              <div key={run.id}>
                <span className={`status-dot ${run.status}`} />
                <span>
                  {run.status}
                  <small>
                    {new Date(run.created_at * 1000).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                </span>
                <span className="mono">{run.id.slice(0, 6)}</span>
              </div>
            ))}
          </div>
        )}
      </aside>
      {settings && (
        <RoomSettings
          room={room}
          connections={connections}
          close={() => setSettings(false)}
          saved={() => {
            void reload();
            changed();
          }}
        />
      )}
    </div>
  );
}
function MessageCard({ message, room }: { message: Message; room: Room }) {
  const [copied, setCopied] = useState(false);
  const agent = room.agents.find((a) => a.id === message.agent_id);
  const failed = message.role === 'error' || message.role === 'partial';
  return (
    <article
      className={`message-row ${message.role === 'user' ? 'user-message' : ''} ${failed ? 'failed-message' : ''}`}
    >
      <Avatar name={message.name} color={message.role === 'user' ? '#596579' : agent?.color} />
      <div className="message-content">
        <div className="message-heading">
          <b>{message.name}</b>
          {message.model && <span className="model-label mono">{message.model}</span>}
          {failed && (
            <span className="badge warning">
              {message.role === 'partial' ? 'Incomplete' : 'Request failed'}
            </span>
          )}
          <time>
            {new Date(message.created_at * 1000).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </div>
        <div className="markdown">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
              img: (props) => <span>[Image: {props.alt}]</span>,
            }}
          >
            {message.content}
          </Markdown>
        </div>
        <div className="message-footer">
          {message.latency_ms != null && <span>{(message.latency_ms / 1000).toFixed(1)}s</span>}
          {message.output_tokens != null && (
            <span>
              {message.input_tokens ?? '—'} in / {message.output_tokens} out
            </span>
          )}
          <button
            aria-label="Copy message"
            onClick={() => {
              navigator.clipboard
                .writeText(message.content)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {});
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      </div>
    </article>
  );
}
