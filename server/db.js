// SQLite-Zugriff: Öffnen, Pragmas und schrittweise Schema-Migrationen.
import Database from 'better-sqlite3';

// Neue Migrationen nur hinten anhängen, bestehende nie ändern.
export const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pass_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE INDEX sessions_expires ON sessions(expires_at);
      CREATE TABLE saves (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slot TEXT NOT NULL,
        meta TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, slot)
      );
      CREATE TABLE scores (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score INTEGER NOT NULL,
        week INTEGER NOT NULL,
        seed TEXT NOT NULL,
        area TEXT NOT NULL,
        play_time REAL NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX scores_score ON scores(score DESC);
      CREATE INDEX scores_user_score ON scores(user_id, score DESC);
    `,
  },
  {
    // Bestwert je Spieler vorhalten, damit die Bestenliste nicht alle Ergebnisse durchsuchen muss.
    // Trigger halten die Tabelle auch bei direkten Änderungen an scores aktuell.
    version: 2,
    sql: `
      CREATE TABLE user_best (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        score_id INTEGER NOT NULL,
        score INTEGER NOT NULL,
        week INTEGER NOT NULL,
        seed TEXT NOT NULL,
        area TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX user_best_rank ON user_best(score DESC, created_at, score_id);
      INSERT INTO user_best (user_id, score_id, score, week, seed, area, created_at)
        SELECT user_id, id, score, week, seed, area, created_at FROM (
          SELECT s.*, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC, created_at, id) AS rn
            FROM scores s
        ) WHERE rn = 1;
      -- Höherer Wert gewinnt, bei Gleichstand der frühere
      CREATE TRIGGER scores_best_insert AFTER INSERT ON scores BEGIN
        INSERT INTO user_best (user_id, score_id, score, week, seed, area, created_at)
        VALUES (NEW.user_id, NEW.id, NEW.score, NEW.week, NEW.seed, NEW.area, NEW.created_at)
        ON CONFLICT (user_id) DO UPDATE SET
          score_id = excluded.score_id, score = excluded.score, week = excluded.week,
          seed = excluded.seed, area = excluded.area, created_at = excluded.created_at
        WHERE excluded.score > user_best.score
           OR (excluded.score = user_best.score
               AND (excluded.created_at < user_best.created_at
                    OR (excluded.created_at = user_best.created_at AND excluded.score_id < user_best.score_id)));
      END;
      CREATE TRIGGER scores_best_delete AFTER DELETE ON scores
      WHEN OLD.id = (SELECT score_id FROM user_best WHERE user_id = OLD.user_id) BEGIN
        DELETE FROM user_best WHERE user_id = OLD.user_id;
        INSERT INTO user_best (user_id, score_id, score, week, seed, area, created_at)
          SELECT user_id, id, score, week, seed, area, created_at FROM scores
           WHERE user_id = OLD.user_id ORDER BY score DESC, created_at, id LIMIT 1;
      END;
    `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Öffnet die Datenbank und bringt das Schema auf den neuesten Stand. */
export function openDb(dbPath) {
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    // WAL-Datei nach Checkpoints wieder auf höchstens 64 MB kürzen
    db.pragma('journal_size_limit = 67108864');
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const current = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get().v;
  if (current > SCHEMA_VERSION) {
    throw new Error(`Datenbank hat Schemaversion ${current}, dieser Server kennt nur bis ${SCHEMA_VERSION}.`);
  }
  const record = db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)');
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      record.run(m.version, Date.now());
    })();
  }
  return SCHEMA_VERSION;
}
