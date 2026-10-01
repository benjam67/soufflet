// Connexion directe entre deux téléphones (PeerJS / WebRTC), sans serveur de jeu.
// L'hôte s'enregistre sous l'identifiant du salon ; l'invité s'y connecte avec le code.
import type { DataConnection, Peer, PeerOptions } from 'peerjs';
import { peerIdFor, type NetMsg, type Role } from './protocol';

export type NetStatus = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'closed';
export type NetError = 'room-not-found' | 'room-taken' | 'network';

/** Battement de cœur : sans nouvelles pendant ce délai, la connexion est considérée comme perdue. */
const PING_MS = 1500;
const LOST_MS = 5000;
const RETRY_MS = 1500;

/** Serveur de mise en relation : celui de PeerJS, ou un serveur local (`?peer=hôte:port`, pour les tests). */
export function peerOptionsFromUrl(search: string): PeerOptions {
  const p = new URLSearchParams(search).get('peer');
  if (!p) return {};
  const [host, port] = p.split(':');
  return { host, port: Number(port) || 9000, path: '/slap', secure: false };
}

export class NetSession {
  status: NetStatus = 'connecting';
  onMessage: (msg: NetMsg) => void = () => {};
  /** Appelé à chaque changement d'état ; `connected` est aussi appelé après une reconnexion. */
  onStatus: (status: NetStatus) => void = () => {};
  private peer!: Peer;
  private conn: DataConnection | null = null;
  private lastSeen = 0;
  private timers: number[] = [];
  private everConnected = false;
  private destroyed = false;

  private constructor(
    readonly role: Role,
    readonly code: string,
  ) {}

  /**
   * Ouvre un salon (hôte) ou le rejoint (invité). La promesse se résout quand le salon existe
   * (hôte) ou quand la connexion à l'hôte est établie (invité).
   * `resume` : reprise après rechargement — on insiste au lieu d'échouer.
   */
  static async open(role: Role, code: string, options: PeerOptions, resume = false): Promise<NetSession> {
    const s = new NetSession(role, code);
    const { Peer } = await import('peerjs');
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ok = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const fail = (e: NetError) => {
        if (settled) return;
        settled = true;
        s.destroy();
        reject(new Error(e));
      };
      const start = () => {
        if (s.destroyed) return;
        const peer = role === 'host' ? new Peer(peerIdFor(code), options) : new Peer(options);
        s.peer = peer;
        peer.on('open', () => {
          if (role === 'host') {
            s.setStatus(s.everConnected ? 'reconnecting' : 'waiting');
            ok();
          } else {
            s.dial(ok);
          }
        });
        peer.on('connection', (c) => {
          if (role === 'host') s.attach(c);
        });
        peer.on('disconnected', () => {
          // Lien avec le serveur de mise en relation perdu : on le rétablit (la partie en cours continue).
          if (!s.destroyed && !peer.destroyed) s.later(() => !peer.destroyed && peer.reconnect(), RETRY_MS);
        });
        peer.on('error', (err) => {
          const type = (err as { type?: string }).type;
          if (type === 'unavailable-id') {
            // Le code est déjà pris. Reprise : c'est notre ancien enregistrement qui traîne, on réessaie.
            peer.destroy();
            if (resume) s.later(start, RETRY_MS);
            else fail('room-taken');
          } else if (type === 'peer-unavailable') {
            // Salon introuvable. Pendant une partie, l'hôte est peut-être en train de revenir.
            if (s.everConnected || resume) s.later(() => s.dial(ok), RETRY_MS);
            else fail('room-not-found');
          } else if (!settled && (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed')) {
            fail('network');
          }
        });
      };
      start();
      s.later(() => fail(role === 'guest' && !resume ? 'room-not-found' : 'network'), resume ? 60_000 : 20_000);
    });
    s.timers.push(window.setInterval(() => s.heartbeat(), PING_MS));
    return s;
  }

  private dial(onOpen?: () => void) {
    if (this.destroyed || this.peer.destroyed || this.peer.disconnected) return;
    if (this.conn?.open) return;
    const c = this.peer.connect(peerIdFor(this.code), { reliable: true });
    this.attach(c, onOpen);
  }

  private attach(c: DataConnection, onOpen?: () => void) {
    c.on('open', () => {
      if (this.conn && this.conn !== c) this.conn.close();
      this.conn = c;
      this.lastSeen = performance.now();
      this.everConnected = true;
      onOpen?.();
      this.setStatus('connected');
    });
    c.on('data', (d) => {
      this.lastSeen = performance.now();
      const msg = d as NetMsg;
      if (msg && msg.t !== 'ping') this.onMessage(msg);
    });
    const lost = () => {
      if (this.conn === c) this.drop();
    };
    c.on('close', lost);
    c.on('error', lost);
  }

  /** La connexion est tombée : on prévient et on tente de la rétablir. */
  private drop() {
    if (this.destroyed) return;
    this.conn = null;
    this.setStatus('reconnecting');
    if (this.role === 'guest') this.later(() => this.dial(), 300);
  }

  private heartbeat() {
    if (this.destroyed) return;
    if (this.conn?.open) {
      this.conn.send({ t: 'ping' } satisfies NetMsg);
      if (performance.now() - this.lastSeen > LOST_MS) {
        const c = this.conn;
        this.drop();
        c.close();
      }
    } else if (this.role === 'guest' && this.everConnected && this.status === 'reconnecting') {
      this.dial();
    }
  }

  private setStatus(status: NetStatus) {
    const again = status === 'connected';
    if (this.status === status && !again) return;
    this.status = status;
    this.onStatus(status);
  }

  private later(fn: () => void, ms: number) {
    this.timers.push(window.setTimeout(() => !this.destroyed && fn(), ms));
  }

  get connected() {
    return !!this.conn?.open;
  }

  /** Envoie un message ; renvoie false si la connexion est coupée (il sera rattrapé à la reprise). */
  send(msg: NetMsg): boolean {
    if (!this.conn?.open) return false;
    this.conn.send(msg);
    return true;
  }

  /** Pour les tests : coupe la connexion comme le ferait une perte de réseau. */
  simulateDrop() {
    this.conn?.close();
  }

  destroy() {
    this.destroyed = true;
    for (const t of this.timers) {
      window.clearTimeout(t);
      window.clearInterval(t);
    }
    this.conn?.close();
    this.peer?.destroy();
    this.status = 'closed';
  }
}
