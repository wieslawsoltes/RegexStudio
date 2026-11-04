import { checkAbort, DataError } from './errors.js';
import { MAX_DATA_BYTES, parseData } from './formats.js';

function remoteName(response, url) {
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded).split(/[\\/]/).at(-1); } catch { /* Fall back to the ordinary filename. */ }
  }
  const filename = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(disposition);
  if (filename) return (filename[1] || filename[2]).trim().split(/[\\/]/).at(-1);
  try { return decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || url.hostname); }
  catch { return url.hostname; }
}

/** Explicit user-triggered HTTP GET. Request headers are never retained in the result. */
export async function fetchData(address, { headers = {}, signal, timeoutMs = 20_000, maxBytes = MAX_DATA_BYTES, credentials = 'omit', ...parseOptions } = {}) {
  let url;
  try { url = new URL(address); }
  catch { throw new DataError('Enter a complete URL beginning with https://.', 'invalid-url'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new DataError('Online sources must use an HTTP or HTTPS URL.', 'invalid-url');
  if (url.username || url.password) throw new DataError('Put authentication in the request headers instead of the URL.', 'invalid-url');
  if (globalThis.location?.protocol === 'https:' && url.protocol === 'http:') throw new DataError('This page uses HTTPS, so the browser requires an HTTPS data source too.', 'mixed-content');
  if (!['omit', 'same-origin', 'include'].includes(credentials)) throw new DataError('Invalid request credentials mode.', 'invalid-request');
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('The data source did not respond in time.', 'TimeoutError')), Math.max(1_000, timeoutMs));
  let reader;
  try {
    checkAbort(signal);
    const response = await fetch(url, { method: 'GET', headers: new Headers(headers), signal: controller.signal, mode: 'cors', credentials, redirect: 'follow', referrerPolicy: 'no-referrer' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DataError(`The source returned HTTP ${response.status}${response.statusText ? ` (${response.statusText})` : ''}.`, 'http-error', { status: response.status });
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel();
      throw new DataError(`The source exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB download limit.`, 'data-limit');
    }
    const chunks = [];
    let total = 0;
    if (response.body) {
      reader = response.body.getReader();
      while (true) {
        checkAbort(controller.signal);
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new DataError(`The source exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB download limit.`, 'data-limit');
        }
        chunks.push(value);
      }
    } else {
      const buffer = await response.arrayBuffer();
      total = buffer.byteLength;
      if (total > maxBytes) throw new DataError('The source exceeds the download size limit.', 'data-limit');
      chunks.push(new Uint8Array(buffer));
    }
    checkAbort(controller.signal);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const contentType = response.headers.get('content-type') || '';
    const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1];
    const source = { kind: 'url', url: url.href, fetchedAt: new Date().toISOString(), contentType };
    return await parseData(bytes, { ...parseOptions, type: contentType, encoding: parseOptions.encoding || charset, name: parseOptions.name || remoteName(response, url), maxBytes, signal: controller.signal, source });
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (controller.signal.aborted) throw new DataError('The online source timed out. Try again or download the file and import it.', 'request-timeout');
    if (error instanceof DataError) throw error;
    throw new DataError(`The browser could not read this source. Check the URL, network access and the source's CORS settings. ${error.message}`, 'network-error');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    reader?.releaseLock();
  }
}
