export class JobCancelledError extends Error {
  constructor(message = "Job cancelled by user") {
    super(message);
    this.name = "JobCancelledError";
  }
}

export function createJobControl(jobId) {
  const browsers = new Set();
  let cancelled = false;

  return {
    jobId,
    isCancelled() {
      return cancelled;
    },
    check() {
      if (cancelled) throw new JobCancelledError();
    },
    cancel() {
      cancelled = true;
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

export function createMutex() {
  let chain = Promise.resolve();
  return {
    run(fn) {
      const result = chain.then(fn);
      chain = result.catch(() => {});
      return result;
    },
  };
}
