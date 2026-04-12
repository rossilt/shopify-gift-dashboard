const express = require("express");
const path = require("path");
const session = require("express-session");

const { SESSION_SECRET } = require("./config");
const { attachCurrentUser } = require("./auth");
const { initDb, createSessionStore, dbEnabled } = require("./db");
const webRoutes = require("./routes/web");
const apiRoutes = require("./routes/api");

const app = express();
const PORT = process.env.PORT || 3000;

if (!SESSION_SECRET) {
  throw new Error("Missing SESSION_SECRET in .env");
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const sessionConfig = {
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 8,
  },
};

const pgSessionStore = createSessionStore(session);
if (pgSessionStore) {
  sessionConfig.store = pgSessionStore;
}

app.use(session(sessionConfig));
app.use(attachCurrentUser);

app.use("/", webRoutes);
app.use("/api", apiRoutes);

app.use((req, res) => {
  res.status(404).send("Page not found");
});

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).send(`Server error: ${err.message}`);
});

async function startServer() {
  await initDb();

  app.listen(PORT, () => {
    console.log(`Gift dashboard running on http://localhost:${PORT}`);
    console.log(`Database mode: ${dbEnabled ? "enabled" : "memory fallback"}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});