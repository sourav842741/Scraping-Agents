export class JobCancelledError extends Error {
  constructor(message = "Job cancelled by user") {
    super(message);
    this.name = "JobCancelledError";
  }
}

export function createJobControl() {
  const browsers = new Set();
  let cancelled = false;
  const abortController = new AbortController();

  return {
    get signal() {
      return abortController.signal;
    },
    isCancelled() {
      return cancelled;
    },
    check() {
      if (cancelled) throw new JobCancelledError();
    },
    cancel() {
      cancelled = true;
      abortController.abort();
      for (const browser of browsers) {
        browser.close().catch(() => {});
      }
      browsers.clear();
    },
    trackBrowser(browser) {
      browsers.add(browser);
      return browser;
    },
    untrackBrowser(browser) {
      browsers.delete(browser);
    },
  };
}
