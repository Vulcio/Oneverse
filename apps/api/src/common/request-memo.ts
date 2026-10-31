import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What one request reads more than once - the user's teams, their roles,
 * the security settings - read once for that request (issue #341): a set's
 * page asked for the user's teams dozens of times. Only for requests that
 * read (GET, HEAD): a write may change those as it goes, so it reads them
 * fresh each time, as before. Nothing is kept beyond the request, so an
 * admin's change is seen by the next one, whichever process serves it.
 */
const memos = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Runs a request's handling with its own memo when it only reads (Express middleware). */
export function requestMemoMiddleware(request: { method: string }, _response: unknown, next: () => void): void {
  if (request.method === "GET" || request.method === "HEAD") memos.run(new Map(), next);
  else next();
}

/** `load()`'s answer, read once per request under `key` (or each time outside a reading request). */
export function requestMemo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const memo = memos.getStore();
  if (!memo) return load();
  let found = memo.get(key) as Promise<T> | undefined;
  if (!found) {
    found = load();
    memo.set(key, found);
    // A failed read isn't kept: the next asks again.
    found.catch(() => memo.delete(key));
  }
  return found;
}
