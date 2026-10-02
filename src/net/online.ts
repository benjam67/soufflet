// Partie en ligne : relie la connexion (NetSession) au match — journal des actions,
// file des actions reçues, sauvegarde locale, revanche.
import type { TurnAction } from '../logic/match';
import { clearSession, PROTOCOL_VERSION, reconcile, saveSession, sideOf, type NetMsg, type Stage } from './protocol';
import type { NetSession, NetStatus } from './session';

export class OnlineGame {
  matchId = 1;
  /** Toutes les actions jouées depuis le début du match, dans l'ordre. */
  log: TurnAction[] = [];
  /** Actions de l'adversaire reçues mais pas encore jouées à l'écran, par numéro de tour. */
  private queue = new Map<number, TurnAction>();

  // Branchés par la scène de combat.
  onPress: () => void = () => {};
  onCancel: () => void = () => {};
  onStage: (stage: Stage) => void = () => {};
  onStatus: (status: NetStatus) => void = () => {};
  /** L'état distant fait foi (ou revanche) : la scène doit repartir du journal. */
  onRestart: () => void = () => {};

  constructor(
    readonly session: NetSession,
    saved?: { matchId: number; log: TurnAction[] },
  ) {
    if (saved) {
      this.matchId = saved.matchId;
      this.log = [...saved.log];
    }
    session.onMessage = (m) => this.receive(m);
    session.onStatus = (s) => {
      if (s === 'connected') this.hello();
      this.publish();
      this.onStatus(s);
    };
    if (session.connected) this.hello();
    this.persist();
    this.publish();
  }

  get role() {
    return this.session.role;
  }
  get code() {
    return this.session.code;
  }
  get localSide() {
    return sideOf(this.session.role);
  }
  get connected() {
    return this.session.connected;
  }

  private hello() {
    this.session.send({ t: 'hello', v: PROTOCOL_VERSION, matchId: this.matchId, log: this.log });
  }

  private receive(msg: NetMsg) {
    switch (msg.t) {
      case 'hello': {
        const r = reconcile({ matchId: this.matchId, log: this.log }, { matchId: msg.matchId, log: msg.log }, this.role);
        if (r.adopt) {
          this.matchId = r.adopt.matchId;
          this.log = r.adopt.log;
          this.queue.clear();
          this.persist();
          this.onRestart();
        } else {
          // Actions jouées en face pendant la coupure : on les met en file, la scène les jouera.
          r.missing.forEach((a, i) => this.queue.set(this.log.length + i, a));
        }
        break;
      }
      case 'action':
        if (msg.matchId === this.matchId && msg.n >= this.log.length) this.queue.set(msg.n, msg.action);
        break;
      case 'press':
        if (msg.matchId === this.matchId && msg.n === this.log.length) this.onPress();
        break;
      case 'cancel':
        if (msg.matchId === this.matchId && msg.n === this.log.length) this.onCancel();
        break;
      case 'stage':
        if (msg.matchId === this.matchId && msg.n === this.log.length) this.onStage(msg.stage);
        break;
      case 'rematch':
        if (msg.matchId > this.matchId) {
          this.matchId = msg.matchId;
          this.log = [];
          this.queue.clear();
          this.persist();
          this.onRestart();
        }
        break;
      default:
        break;
    }
    this.publish();
  }

  /** Le joueur local a joué le tour n° `n`. */
  sendAction(n: number, action: TurnAction) {
    if (n !== this.log.length) return;
    this.log.push(action);
    this.persist();
    this.session.send({ t: 'action', matchId: this.matchId, n, action });
    this.publish();
  }

  /** Action de l'adversaire pour le tour n° `n`, si elle est arrivée. */
  takeRemote(n: number): TurnAction | undefined {
    if (n !== this.log.length) return undefined;
    const a = this.queue.get(n);
    if (!a) return undefined;
    this.queue.delete(n);
    this.log.push(a);
    this.persist();
    this.publish();
    return a;
  }

  sendPress() {
    this.session.send({ t: 'press', matchId: this.matchId, n: this.log.length });
  }

  sendCancel() {
    this.session.send({ t: 'cancel', matchId: this.matchId, n: this.log.length });
  }

  sendStage(stage: Stage) {
    this.session.send({ t: 'stage', matchId: this.matchId, n: this.log.length, stage });
  }

  /** Lance une revanche des deux côtés. */
  rematch() {
    this.matchId++;
    this.log = [];
    this.queue.clear();
    this.persist();
    this.session.send({ t: 'rematch', matchId: this.matchId });
    this.publish();
  }

  /** Quitte le salon. */
  leave() {
    clearSession();
    this.session.destroy();
    if (window.__slap) delete (window.__slap as Record<string, unknown>).net;
  }

  private persist() {
    saveSession({ code: this.code, role: this.role, matchId: this.matchId, log: this.log });
  }

  /** État lisible par les tests. */
  private publish() {
    if (!window.__slap) return;
    (window.__slap as Record<string, unknown>).net = {
      code: this.code,
      role: this.role,
      status: this.session.status,
      matchId: this.matchId,
      turns: this.log.length,
      queued: this.queue.size,
    };
  }
}
