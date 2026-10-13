import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity as ActivityIcon,
  ChevronDown,
  Command,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Server,
  Settings2,
  Users,
  X,
} from 'lucide-react';
import { api, errorMessage } from './api';
import type { Connection, RoomSummary, User, Workspace } from './types';
import { Auth } from './components/Auth';
import { Conversation } from './components/Conversation';
import { Providers } from './components/Providers';
import { Activity, Team } from './components/Team';
import { Avatar, Empty, ErrorNotice, Modal, Spinner } from './components/ui';

type View = 'rooms' | 'providers' | 'team' | 'activity';
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [workspaceId, setWorkspaceId] = useState('');
  const [connections, setConnections] = useState<Connection[]>([]),
    [rooms, setRooms] = useState<RoomSummary[]>([]),
    [roomId, setRoomId] = useState<string | null>(null);
  const [view, setView] = useState<View>('rooms'),
    [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [mobileNav, setMobileNav] = useState(false);
  const [newRoom, setNewRoom] = useState(false),
    [title, setTitle] = useState(''),
    [creating, setCreating] = useState(false);
  const selectedWorkspace = useRef(workspaceId);
  selectedWorkspace.current = workspaceId;
  const workspace = workspaces.find((w) => w.id === workspaceId);
  useEffect(() => {
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecking(false));
    const expire = () => {
      setUser(null);
      setError('');
    };
    window.addEventListener('moe:session-expired', expire);
    return () => window.removeEventListener('moe:session-expired', expire);
  }, []);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    async function initialize() {
      try {
        const invite = new URLSearchParams(window.location.search).get('invite');
        let invitedWorkspace = '';
        if (invite) {
          try {
            invitedWorkspace = (
              await api<{ workspace_id: string }>(
                `/invites/${encodeURIComponent(invite)}/accept`,
                'POST',
              )
            ).workspace_id;
          } catch (error) {
            setError(errorMessage(error));
          }
          history.replaceState(null, '', window.location.pathname);
        }
        const items = await api<Workspace[]>('/workspaces');
        if (alive) {
          setWorkspaces(items);
          setWorkspaceId(
            invitedWorkspace ||
              items.find((w) => w.id === localStorage.getItem('moe.workspace'))?.id ||
              items[0]?.id ||
              '',
          );
        }
      } catch (error) {
        if (alive) setError(errorMessage(error));
      }
    }
    void initialize();
    return () => {
      alive = false;
    };
  }, [user?.id]);
  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [nextRooms, nextConnections] = await Promise.all([
        api<RoomSummary[]>(`/workspaces/${workspaceId}/rooms`),
        api<Connection[]>(`/workspaces/${workspaceId}/connections`),
      ]);
      if (selectedWorkspace.current !== workspaceId) return;
      setRooms(nextRooms);
      setConnections(nextConnections);
      setRoomId((previous) =>
        previous && nextRooms.some((r) => r.id === previous) ? previous : nextRooms[0]?.id || null,
      );
    } catch (error) {
      setError(errorMessage(error));
    }
  }, [workspaceId]);
  useEffect(() => {
    setRooms([]);
    setConnections([]);
    setRoomId(null);
    setError('');
    if (workspaceId) {
      localStorage.setItem('moe.workspace', workspaceId);
      void refresh();
    }
  }, [workspaceId, refresh]);
  async function createRoom(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const room = await api<RoomSummary>(`/workspaces/${workspaceId}/rooms`, 'POST', {
        title: title.trim() || 'Untitled room',
      });
      setRoomId(room.id);
      setView('rooms');
      setNewRoom(false);
      setTitle('');
      void refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }
  async function logout() {
    await api('/auth/logout', 'POST').catch(() => {});
    setUser(null);
    setWorkspaces([]);
    setRoomId(null);
  }
  function changeView(next: View) {
    setView(next);
    setMobileNav(false);
  }
  if (checking)
    return (
      <div className="loading full-screen">
        <Spinner /> Opening your workspace
      </div>
    );
  if (!user) return <Auth onLogin={setUser} />;
  return (
    <div className="app-layout">
      <button
        className="mobile-menu icon-button"
        onClick={() => setMobileNav(!mobileNav)}
        aria-label="Toggle navigation"
      >
        {mobileNav ? <X size={18} /> : <Menu size={18} />}
      </button>
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand">
          <div className="logo">m</div>
          <b>
            moe<span> / workspace</span>
          </b>
          <span className="version">V2</span>
        </div>
        <div className="workspace-select">
          <span className="workspace-icon">
            <Command size={16} />
          </span>
          <select
            aria-label="Workspace"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </div>
        <div className="sidebar-label">Workspace</div>
        <nav>
          {(
            [
              { view: 'rooms', label: 'Conversations', icon: MessageSquare },
              { view: 'providers', label: 'Model connections', icon: Server },
              { view: 'team', label: 'Team & access', icon: Users },
              ...(workspace?.role === 'owner'
                ? [{ view: 'activity', label: 'Activity log', icon: ActivityIcon }]
                : []),
            ] as const
          ).map((item) => (
            <button
              key={item.view}
              className={`nav-item ${view === item.view ? 'active' : ''}`}
              onClick={() => changeView(item.view as View)}
            >
              <item.icon size={17} />
              {item.label}
              {item.view === 'rooms' && <span>{rooms.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <div className="sidebar-label">
            Your rooms
            {workspace?.role !== 'viewer' && (
              <button className="icon-button" title="Create room" onClick={() => setNewRoom(true)}>
                <Plus size={15} />
              </button>
            )}
          </div>
          <label className="room-search">
            <Search size={13} />
            <input
              aria-label="Search rooms"
              placeholder="Search conversations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="room-list">
            {rooms
              .filter((r) => r.title.toLowerCase().includes(search.toLowerCase()))
              .map((room) => (
                <button
                  className={`room-link ${view === 'rooms' && roomId === room.id ? 'selected' : ''}`}
                  key={room.id}
                  onClick={() => {
                    setRoomId(room.id);
                    changeView('rooms');
                  }}
                >
                  <span className="room-link-icon">
                    <MessageSquare size={14} />
                  </span>
                  <span>
                    {room.title}
                    <small>
                      {new Date(room.updated_at * 1000).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </small>
                  </span>
                </button>
              ))}
            {!rooms.length && (
              <p className="sidebar-empty">Create a room to bring your agents together.</p>
            )}
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="workspace-status">
            <span className="dot green" />
            Private workspace<span className="badge">{workspace?.role}</span>
          </div>
          <button className="profile-button" onClick={logout} title="Sign out">
            <Avatar name={user.name} color="#52616f" size="small" />
            <span>
              {user.name}
              <small>{user.email}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        {error && (
          <div className="global-error">
            <ErrorNotice>{error}</ErrorNotice>
            <button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error">
              <X size={14} />
            </button>
          </div>
        )}
        {!workspace ? (
          <Empty title="Opening your workspace" text="Loading your rooms and model connections." />
        ) : view === 'rooms' ? (
          roomId ? (
            <Conversation
              key={roomId}
              id={roomId}
              connections={connections}
              writable={workspace.role !== 'viewer'}
              changed={refresh}
              deleted={() => {
                setRoomId(null);
                void refresh();
              }}
            />
          ) : (
            <Empty
              title="Your ideas deserve a room"
              text="Create a conversation, connect your models, and choose how your agents work together."
              action={
                workspace.role !== 'viewer' && (
                  <div className="empty-actions">
                    <button className="button primary" onClick={() => setNewRoom(true)}>
                      <Plus size={15} /> Create a room
                    </button>
                    <button className="button secondary" onClick={() => changeView('providers')}>
                      <Settings2 size={15} /> Connect a provider
                    </button>
                  </div>
                )
              }
            />
          )
        ) : view === 'providers' ? (
          <Providers
            workspaceId={workspaceId}
            connections={connections}
            owner={workspace.role === 'owner'}
            refresh={refresh}
          />
        ) : view === 'team' ? (
          <Team workspaceId={workspaceId} owner={workspace.role === 'owner'} user={user} />
        ) : (
          <Activity workspaceId={workspaceId} />
        )}
      </main>
      {newRoom && (
        <Modal
          title="Create a conversation room"
          subtitle="Start with a name. Configure the agents and rules inside the room."
          close={() => setNewRoom(false)}
        >
          <form onSubmit={createRoom}>
            <div className="modal-body">
              <label>
                Room name
                <input
                  autoFocus
                  maxLength={120}
                  placeholder="e.g. Product council or Architecture review"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
            </div>
            <footer className="modal-footer">
              <button className="button secondary" type="button" onClick={() => setNewRoom(false)}>
                Cancel
              </button>
              <button className="button primary" disabled={creating}>
                {creating ? <Spinner /> : <Plus size={15} />} Create room
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  );
}
