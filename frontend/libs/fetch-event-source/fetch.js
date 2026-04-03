// Vendored from @microsoft/fetch-event-source (MIT), adapted for browser ESM loading.
import { getBytes, getLines, getMessages } from "./parse.js";

const EventStreamContentType = "text/event-stream";
const DefaultRetryInterval = 1000;
const LastEventId = "last-event-id";

function rest(source, excluded) {
  const target = {};
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key) && !excluded.includes(key)) {
      target[key] = source[key];
    }
  }
  if (source != null && typeof Object.getOwnPropertySymbols === "function") {
    for (const key of Object.getOwnPropertySymbols(source)) {
      if (!excluded.includes(key) && Object.prototype.propertyIsEnumerable.call(source, key)) {
        target[key] = source[key];
      }
    }
  }
  return target;
}

export { EventStreamContentType };

export function fetchEventSource(input, init) {
  const {
    signal: inputSignal,
    headers: inputHeaders,
    onopen: inputOnOpen,
    onmessage,
    onclose,
    onerror,
    openWhenHidden,
    fetch: inputFetch,
  } = init;
  const requestInit = rest(init, [
    "signal",
    "headers",
    "onopen",
    "onmessage",
    "onclose",
    "onerror",
    "openWhenHidden",
    "fetch",
  ]);

  return new Promise((resolve, reject) => {
    const headers = { ...(inputHeaders || {}) };
    if (!headers.accept) {
      headers.accept = EventStreamContentType;
    }

    let curRequestController;

    function onVisibilityChange() {
      curRequestController.abort();
      if (!document.hidden) {
        create();
      }
    }

    if (!openWhenHidden) {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    let retryInterval = DefaultRetryInterval;
    let retryTimer = 0;

    function dispose() {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearTimeout(retryTimer);
      curRequestController.abort();
    }

    inputSignal?.addEventListener("abort", () => {
      dispose();
      resolve();
    });

    const runFetch = inputFetch ?? window.fetch;
    const onopen = inputOnOpen ?? defaultOnOpen;

    async function create() {
      curRequestController = new AbortController();
      try {
        const response = await runFetch(input, {
          ...requestInit,
          headers,
          signal: curRequestController.signal,
        });
        await onopen(response);
        await getBytes(
          response.body,
          getLines(
            getMessages(
              (id) => {
                if (id) {
                  headers[LastEventId] = id;
                } else {
                  delete headers[LastEventId];
                }
              },
              (retry) => {
                retryInterval = retry;
              },
              onmessage
            )
          )
        );
        onclose?.();
        dispose();
        resolve();
      } catch (error) {
        if (!curRequestController.signal.aborted) {
          try {
            const interval = onerror?.(error) ?? retryInterval;
            window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(create, interval);
          } catch (innerError) {
            dispose();
            reject(innerError);
          }
        }
      }
    }

    create();
  });
}

function defaultOnOpen(response) {
  const contentType = response.headers.get("content-type");
  if (!contentType?.startsWith(EventStreamContentType)) {
    throw new Error(
      `Expected content-type to be ${EventStreamContentType}, Actual: ${contentType}`
    );
  }
}
