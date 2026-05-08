const { randomUUID } = require("crypto");

const ONE_HOUR_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const jobs = new Map();

function createJob(meta = {}) {
  const id = randomUUID();
  const job = {
    id,
    state: "running",
    phase: "queued",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    fetched: 0,
    total: 0,
    processed: 0,
    applied: 0,
    skipped: 0,
    failed: 0,
    error: null,
    runId: null,
    ...meta,
  };

  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function patchJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
}

function listJobs() {
  return Array.from(jobs.values());
}

function cleanup() {
  const cutoff = Date.now() - ONE_HOUR_MS;
  for (const [id, job] of jobs) {
    if (!job.finishedAt) continue;
    if (new Date(job.finishedAt).getTime() < cutoff) {
      jobs.delete(id);
    }
  }
}

const cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();

module.exports = {
  createJob,
  getJob,
  patchJob,
  listJobs,
};
