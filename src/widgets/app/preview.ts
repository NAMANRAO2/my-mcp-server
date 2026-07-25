'use client';

import { useEffect, useState } from 'react';
import manifest from '../widget-manifest.json';

/**
 * Development preview.
 *
 * A widget normally renders from tool output handed to it by the host, so opening one directly in
 * a browser shows nothing. Adding `?preview=1` falls back to the example data in
 * widget-manifest.json — the same examples NitroStudio uses — so layout and styling can be checked
 * without a running agent.
 *
 * Opt-in via query param only, so this never affects a real render.
 *
 *   http://localhost:3001/portfolio-dashboard?preview=1
 *   http://localhost:3001/intervention-modal?preview=1&theme=dark
 *
 * Read after mount rather than during render, so server and client markup agree.
 */
export function usePreviewData<T>(uri: string): T | null {
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('preview')) return;
    const widget = manifest.widgets.find((w) => w.uri === uri);
    const example = widget?.examples?.[0]?.data;
    if (example) setData(example as unknown as T);
  }, [uri]);

  return data;
}

/** Lets `?theme=dark` override the host theme, so both modes can be checked in one browser. */
export function usePreviewTheme(): string | null {
  const [theme, setTheme] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('preview')) return;
    const requested = params.get('theme');
    if (requested === 'dark' || requested === 'light') setTheme(requested);
  }, []);

  return theme;
}
