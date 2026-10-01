// Salon du jeu en ligne : créer un salon (code à 4 lettres) ou en rejoindre un.
// Interface en HTML par-dessus le jeu, pour profiter du clavier du téléphone.
import { OnlineGame } from './online';
import { makeCode, normalizeCode, type SavedSession } from './protocol';
import { NetSession, peerOptionsFromUrl } from './session';

type View = 'choice' | 'host' | 'join' | 'busy';

const ERRORS: Record<string, string> = {
  'room-not-found': 'Salon introuvable. Vérifie le code.',
  'room-taken': 'Ce code est déjà pris, réessaie.',
  network: 'Pas de connexion au serveur. Réessaie.',
};

/** Lien à partager pour rejoindre directement le salon. */
export function joinLink(code: string): string {
  const u = new URL(location.href);
  const peer = u.searchParams.get('peer');
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', code);
  if (peer) u.searchParams.set('peer', peer);
  return u.toString();
}

/**
 * Affiche le salon et renvoie la partie en ligne une fois les deux joueurs connectés
 * (ou `null` si le joueur revient en arrière).
 * - `join` : code reçu par lien, on rejoint directement.
 * - `resume` : partie sauvegardée (page rechargée), on la reprend.
 */
export function openLobby(opts: { join?: string; resume?: SavedSession } = {}): Promise<OnlineGame | null> {
  const root = document.getElementById('lobby') as HTMLElement;
  const input = root.querySelector('#lobby-code') as HTMLInputElement;
  const codeShow = root.querySelector('#lobby-code-show') as HTMLElement;
  const peerOptions = peerOptionsFromUrl(location.search);
  let session: NetSession | null = null;
  let done = false;

  const show = (view: View, status = '', err = false) => {
    root.dataset.show = view;
    const el = root.querySelector(`[data-view="${view}"] [data-status]`) as HTMLElement | null;
    if (el) {
      if (status || view !== 'host') el.textContent = status;
      el.classList.toggle('err', err);
    }
    if (window.__slap) (window.__slap as Record<string, unknown>).lobby = { view, status, code: codeShow.textContent };
  };

  return new Promise((resolve) => {
    const finish = (game: OnlineGame | null) => {
      if (done) return;
      done = true;
      root.hidden = true;
      root.removeEventListener('click', onClick);
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('input', onInput);
      if (window.__slap) delete (window.__slap as Record<string, unknown>).lobby;
      resolve(game);
    };

    const host = async () => {
      show('busy', 'Création du salon…');
      for (let attempt = 0; attempt < 6 && !done; attempt++) {
        const code = makeCode();
        try {
          session = await NetSession.open('host', code, peerOptions);
        } catch (e) {
          if ((e as Error).message === 'room-taken') continue;
          return showChoiceError(ERRORS[(e as Error).message] ?? ERRORS.network);
        }
        if (done) return session.destroy();
        codeShow.textContent = code;
        show('host', 'En attente de ton adversaire…');
        const s = session;
        s.onStatus = (st) => {
          if (st === 'connected') finish(new OnlineGame(s));
        };
        if (s.connected) finish(new OnlineGame(s));
        return;
      }
      showChoiceError(ERRORS.network);
    };

    const join = async (raw: string) => {
      const code = normalizeCode(raw);
      if (!code) return show('join', 'Le code fait 4 lettres.', true);
      show('busy', `Connexion au salon ${code}…`);
      try {
        session = await NetSession.open('guest', code, peerOptions);
      } catch (e) {
        input.value = code;
        return show('join', ERRORS[(e as Error).message] ?? ERRORS.network, true);
      }
      if (done) return session.destroy();
      finish(new OnlineGame(session));
    };

    const resume = async (saved: SavedSession) => {
      show('busy', `Reprise de la partie (salon ${saved.code})…`);
      try {
        session = await NetSession.open(saved.role, saved.code, peerOptions, true);
      } catch {
        return showChoiceError('Impossible de reprendre la partie.');
      }
      if (done) return session.destroy();
      finish(new OnlineGame(session, saved));
    };

    const showChoiceError = (text: string) => {
      show('choice');
      const p = root.querySelector('[data-view="choice"] p') as HTMLElement;
      p.textContent = text;
      p.style.color = 'var(--pink)';
    };

    const share = async () => {
      const code = codeShow.textContent ?? '';
      const url = joinLink(code);
      const el = root.querySelector('[data-view="host"] [data-status]') as HTMLElement;
      try {
        if (navigator.share) await navigator.share({ title: 'Slap Fighter', text: `Viens te prendre une gifle ! Salon ${code}`, url });
        else {
          await navigator.clipboard.writeText(url);
          el.textContent = 'Lien copié ! Envoie-le à ton adversaire.';
        }
      } catch {
        el.textContent = `Lien : ${url}`;
      }
    };

    const onClick = (e: Event) => {
      const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
      if (!act) return;
      if (act === 'create') void host();
      else if (act === 'join') {
        show('join');
        input.value = '';
        input.focus();
      } else if (act === 'go') void join(input.value);
      else if (act === 'share') void share();
      else if (act === 'back') {
        session?.destroy();
        session = null;
        if (root.dataset.show === 'choice') finish(null);
        else show('choice');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') void join(input.value);
    };
    const onInput = () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (input.value.length === 4) input.blur();
    };

    root.addEventListener('click', onClick);
    input.addEventListener('keydown', onKey);
    input.addEventListener('input', onInput);
    const p = root.querySelector('[data-view="choice"] p') as HTMLElement;
    p.textContent = 'Chacun sur son téléphone, avec un code de salon.';
    p.style.color = '';
    root.hidden = false;
    show('choice');
    if (opts.resume) void resume(opts.resume);
    else if (opts.join) void join(opts.join);
  });
}

/** Bandeau « connexion perdue » par-dessus le combat. */
export function showNetLost(visible: boolean) {
  const el = document.getElementById('netlost');
  if (el) el.hidden = !visible;
}
