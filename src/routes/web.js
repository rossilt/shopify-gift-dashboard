const express = require("express");

const { runGiftJob } = require("../services/giftEngine");
const runLogger = require("../services/runLogger");
const settingsStore = require("../services/settingsStore");
const jobManager = require("../services/jobManager");
const {
  requireAuth,
  redirectIfAuthenticated,
  verifyCredentials,
  loginUser,
  logoutUser,
} = require("../auth");

const router = express.Router();

function parseSkuList(raw) {
  return [
    ...new Set(
      String(raw || "")
        .split(",")
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean)
    ),
  ];
}

function parseLimitInput(raw) {
  if (!raw || String(raw).trim() === "") return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Limit must be a positive number");
  }

  return parsed;
}

function parseSettings(body, currentSettings) {
  const scheduleHour = Number(body.scheduleHour);
  const scheduleMinute = Number(body.scheduleMinute);

  if (!Number.isInteger(scheduleHour) || scheduleHour < 0 || scheduleHour > 23) {
    throw new Error("Schedule hour must be between 0 and 23");
  }

  if (!Number.isInteger(scheduleMinute) || scheduleMinute < 0 || scheduleMinute > 59) {
    throw new Error("Schedule minute must be between 0 and 59");
  }

  const reasonText = String(body.reasonText || "").trim();
  const timezone = String(body.timezone || "").trim();

  if (!reasonText) {
    throw new Error("Reason text cannot be empty");
  }

  if (!timezone) {
    throw new Error("Timezone cannot be empty");
  }

  const nextGiftRules = currentSettings.giftRules.map((rule) => {
    const fieldName = `giftRule_${rule.tier}`;
    const skus = parseSkuList(body[fieldName]);

    if (skus.length === 0) {
      throw new Error(`Enter at least one SKU for ${rule.label}`);
    }

    return {
      ...rule,
      skus,
    };
  });

  return {
    reasonText,
    scheduleEnabled: body.scheduleEnabled === "on",
    scheduleHour,
    scheduleMinute,
    timezone,
    giftRules: nextGiftRules,
  };
}

async function renderDashboard(res, extra = {}) {
  const latestRun = await runLogger.getLatestRun();
  const settings = await settingsStore.getSettings();

  res.render("dashboard", {
    title: "Gift Mask Dashboard",
    latestRun,
    giftRules: settings.giftRules,
    giftReason: settings.reasonText,
    settings,
    error: null,
    success: null,
    ...extra,
  });
}

router.get("/login", redirectIfAuthenticated, (req, res) => {
  res.render("login", {
    title: "Login",
    error: null,
  });
});

router.post("/login", redirectIfAuthenticated, (req, res) => {
  const username = req.body.username || "";
  const password = req.body.password || "";

  if (!verifyCredentials(username, password)) {
    return res.status(401).render("login", {
      title: "Login",
      error: "Invalid username or password",
    });
  }

  loginUser(req);

  req.session.save((error) => {
    if (error) {
      return res.status(500).render("login", {
        title: "Login",
        error: "Could not start session",
      });
    }

    return res.redirect("/");
  });
});

router.get("/logout", requireAuth, async (req, res) => {
  try {
    await logoutUser(req);
    res.clearCookie("connect.sid");
    return res.redirect("/login");
  } catch (error) {
    return res.status(500).send(`Logout failed: ${error.message}`);
  }
});

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    await renderDashboard(res);
  } catch (error) {
    next(error);
  }
});

router.get("/settings", async (req, res, next) => {
  try {
    const settings = await settingsStore.getSettings();

    res.render("settings", {
      title: "Settings",
      settings,
      error: null,
      success: null,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/settings", async (req, res, next) => {
  try {
    const currentSettings = await settingsStore.getSettings();
    const patch = parseSettings(req.body, currentSettings);
    const settings = await settingsStore.updateSettings(patch);

    res.render("settings", {
      title: "Settings",
      settings,
      error: null,
      success: "Settings saved successfully.",
    });
  } catch (error) {
    try {
      const currentSettings = await settingsStore.getSettings();

      res.status(400).render("settings", {
        title: "Settings",
        settings: {
          ...currentSettings,
          reasonText: req.body.reasonText ?? currentSettings.reasonText,
          scheduleEnabled: req.body.scheduleEnabled === "on",
          scheduleHour: req.body.scheduleHour ?? currentSettings.scheduleHour,
          scheduleMinute: req.body.scheduleMinute ?? currentSettings.scheduleMinute,
          timezone: req.body.timezone ?? currentSettings.timezone,
          giftRules: currentSettings.giftRules.map((rule) => ({
            ...rule,
            skus: parseSkuList(req.body[`giftRule_${rule.tier}`] ?? rule.skus.join(", ")),
          })),
        },
        error: error.message,
        success: null,
      });
    } catch (innerError) {
      next(innerError);
    }
  }
});

router.get("/runs", async (req, res, next) => {
  try {
    const runHistory = await runLogger.listRuns(20);

    res.render("runs", {
      title: "Runs",
      runHistory,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/runs/:id", async (req, res, next) => {
  try {
    const entry = await runLogger.getRunById(req.params.id);

    if (!entry) {
      return res.status(404).send("Run not found");
    }

    res.render("run-detail", {
      title: "Run Detail",
      entry,
    });
  } catch (error) {
    next(error);
  }
});

function startJob({ apply, limit, settings }) {
  const job = jobManager.createJob({
    mode: apply ? "apply" : "dry-run",
    limit,
  });

  // Run asynchronously — caller returns the job ID immediately.
  (async () => {
    try {
      const output = await runGiftJob({
        apply,
        allUnfulfilled: true,
        limit,
        reasonText: settings.reasonText,
        giftRules: settings.giftRules,
        onProgress: (event) => {
          if (event.type === "phase") {
            jobManager.patchJob(job.id, { phase: event.phase });
          } else if (event.type === "fetch-progress") {
            jobManager.patchJob(job.id, { fetched: event.fetched });
          } else if (event.type === "fetched") {
            jobManager.patchJob(job.id, { fetched: event.total, total: event.total });
          } else if (event.type === "planned") {
            jobManager.patchJob(job.id, {
              total: event.total,
              phase: apply ? "applying" : "planning",
            });
          } else if (event.type === "item") {
            jobManager.patchJob(job.id, {
              processed: event.index,
              total: event.total,
              applied: event.applied,
              skipped: event.skipped,
              failed: event.failed,
              currentOrder: event.orderName || null,
              lastStatus: event.status || null,
            });
          } else if (event.type === "summary") {
            jobManager.patchJob(job.id, {
              processed: event.processed,
              applied: event.applied,
              skipped: event.skipped,
              failed: event.failed,
            });
          }
        },
      });

      const entry = await runLogger.saveRun(output);

      jobManager.patchJob(job.id, {
        state: "done",
        phase: "done",
        finishedAt: new Date().toISOString(),
        runId: entry.id,
        applied: output.summary.applied,
        skipped: output.summary.skipped,
        failed: output.summary.failed,
        total: output.summary.totalFetchedOrders,
        processed:
          output.summary.applied +
          output.summary.skipped +
          output.summary.failed +
          output.summary.planned,
        // Compact result rows so the dashboard can render the outcome inline
        // without a full-page reload.
        results: (output.results || []).map((row) => ({
          orderName: row.orderName,
          subtotal: row.subtotal,
          plannedTier: row.plannedTier,
          plannedSku: row.plannedSku,
          status: row.status,
          reason: row.reason,
        })),
      });
    } catch (error) {
      jobManager.patchJob(job.id, {
        state: "error",
        phase: "error",
        finishedAt: new Date().toISOString(),
        error: error.message,
      });
    }
  })();

  return job;
}

router.post("/run/all/start", async (req, res, next) => {
  try {
    let limit;
    try {
      limit = parseLimitInput(req.body.limit);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const apply = req.body.apply === true || req.body.apply === "true";
    const settings = await settingsStore.getSettings();

    const job = startJob({ apply, limit, settings });

    res.json({ jobId: job.id, state: job.state, mode: job.mode });
  } catch (error) {
    next(error);
  }
});

router.get("/run/jobs/:id", (req, res) => {
  const job = jobManager.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

module.exports = router;
