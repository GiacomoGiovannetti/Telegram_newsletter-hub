import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import type { NewsletterItem } from '../types/newsletter';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        initData: string;
        HapticFeedback?: {
          notificationOccurred: (type: 'success' | 'error' | 'warning') => void;
        };
      };
    };
  }
}

type SortOption = 'latest' | 'oldest' | 'random';

const API_URL = (import.meta.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
const TELEGRAM_INIT_DATA = window.Telegram?.WebApp?.initData ?? '';

function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

function apiHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-telegram-init-data': TELEGRAM_INIT_DATA,
  };
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...apiHeaders(),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Richiesta fallita (${response.status})`);
  }

  return response.json() as Promise<T>;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function prepareEmailHtml(html: string | undefined): string {
  if (!html) {
    return '';
  }

  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'ul', 'ol',
      'li', 'strong', 'em', 'blockquote', 'img', 'table', 'tr',
      'td', 'th', 'br',
    ],
    ALLOWED_ATTR: ['href', 'name', 'target', 'rel', 'title', 'src', 'alt', 'width', 'height', 'colspan', 'rowspan'],
  });
  const document = new DOMParser().parseFromString(sanitized, 'text/html');

  document.querySelectorAll('a[href]').forEach((link) => {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });

  document.querySelectorAll('img').forEach((image) => {
    image.setAttribute(
      'style',
      `${image.getAttribute('style') ?? ''}; max-width: 100%; height: auto;`,
    );
  });

  return document.body.innerHTML;
}

export default function NewsletterApp() {
  const [newsletters, setNewsletters] = useState<NewsletterItem[]>([]);
  const [selected, setSelected] = useState<NewsletterItem | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('Tutte');
  const [sort, setSort] = useState<SortOption>('latest');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [archiving, setArchiving] = useState(false);

  const labels = useMemo(
    () =>
      Array.from(new Set(newsletters.flatMap((newsletter) => newsletter.labels))).sort(
        (left, right) => left.localeCompare(right, 'it'),
      ),
    [newsletters],
  );

  async function loadList(activeLabel = selectedLabel, activeSort = sort) {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        unreadOnly: 'true',
        sort: activeSort,
      });

      if (activeLabel !== 'Tutte') {
        params.set('label', activeLabel);
      }

      const items = await fetchJson<NewsletterItem[]>(
        `/api/newsletters?${params.toString()}`,
      );
      setNewsletters(items);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Errore durante il caricamento',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();

    const newsletterId = new URL(window.location.href).searchParams.get('id');

    if (newsletterId) {
      setLoading(true);
      fetchJson<NewsletterItem>(`/api/newsletters/${newsletterId}`)
        .then(setSelected)
        .catch((caughtError: unknown) => {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Newsletter non trovata',
          );
        })
        .finally(() => setLoading(false));
      return;
    }

    void loadList('Tutte', 'latest');
  }, []);

  useEffect(() => {
    if (selected) {
      return;
    }

    void loadList(selectedLabel, sort);
  }, [selectedLabel, sort]);

  async function archiveSelected() {
    if (!selected || archiving) {
      return;
    }

    setArchiving(true);
    setError('');

    try {
      await fetchJson<NewsletterItem>(
        `/api/newsletters/${selected._id}/read`,
        { method: 'PATCH' },
      );
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      setNewsletters((current) =>
        current.filter((newsletter) => newsletter._id !== selected._id),
      );
      setSelected(null);
      setLoading(false);

      const url = new URL(window.location.href);
      url.searchParams.delete('id');
      window.history.replaceState({}, '', url);

      await loadList(selectedLabel, sort);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Errore durante l\'archiviazione',
      );
    } finally {
      setArchiving(false);
    }
  }

  function openNewsletter(newsletter: NewsletterItem) {
    setError('');
    setSelected(newsletter);
  }

  function backToList() {
    setSelected(null);
    setError('');
  }

  if (loading && !selected) {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-4 py-6">
        <p className="text-sm text-slate-400">Caricamento...</p>
      </main>
    );
  }

  if (selected) {
    return (
      <main className="mx-auto min-h-[100dvh] max-w-3xl px-3 pb-28 pt-4">
        <button
          type="button"
          onClick={backToList}
          className="mb-4 text-sm font-medium text-sky-400"
        >
          ← Torna alla lista
        </button>

        <header className="mb-5 px-1">
          <h1 className="text-2xl font-bold leading-tight text-slate-100">
            {selected.subject}
          </h1>
          <p className="mt-2 text-sm text-slate-400">{selected.sender}</p>
          <p className="mt-1 text-sm text-slate-400">
            {formatDate(selected.receivedAt)}
          </p>
          {selected.labels.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {selected.labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </header>

        {error && (
          <p className="mb-4 rounded-lg bg-red-950 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        <article className="overflow-hidden rounded-xl bg-white px-4 py-5 text-slate-900 shadow-lg sm:px-6">
          <div
            className="prose prose-slate max-w-none prose-a:text-sky-700 prose-img:h-auto prose-img:max-w-full"
            dangerouslySetInnerHTML={{
              __html: prepareEmailHtml(selected.bodyHtml),
            }}
          />
        </article>

        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-800 bg-slate-950/95 px-3 py-3 backdrop-blur">
          <button
            type="button"
            onClick={archiveSelected}
            disabled={archiving}
            className="mx-auto block w-full max-w-xl rounded-xl bg-sky-500 px-4 py-3 text-center font-semibold text-white disabled:opacity-60"
          >
            {archiving ? 'Archiviazione...' : 'Segna come letta e archivia'}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 pb-8 pt-4">
      <div className="sticky top-0 z-10 -mx-4 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {['Tutte', ...labels].map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setSelectedLabel(label)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                selectedLabel === label
                  ? 'bg-sky-500 text-white'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as SortOption)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          aria-label="Ordina newsletter"
        >
          <option value="latest">Più recenti</option>
          <option value="oldest">Meno recenti</option>
          <option value="random">Casuale</option>
        </select>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-950 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-sm text-slate-400">Caricamento...</p>
      ) : newsletters.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">
          Nessuna newsletter da leggere.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {newsletters.map((newsletter) => (
            <button
              key={newsletter._id}
              type="button"
              onClick={() => openNewsletter(newsletter)}
              className="w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-left"
            >
              <h2 className="font-semibold leading-snug text-slate-100">
                {newsletter.subject}
              </h2>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-400">
                <span className="truncate">{newsletter.sender}</span>
                <span className="shrink-0">
                  {formatDate(newsletter.receivedAt)}
                </span>
              </div>
              {newsletter.snippet && (
                <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-300">
                  {newsletter.snippet}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
