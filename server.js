const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";

const dataDir = path.join(__dirname, "data");
const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, "campus.db"));
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','admin','staff')),
  department TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low','Medium','High','Urgent')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Assigned','In Progress','Resolved','Rejected')),
  student_id INTEGER NOT NULL,
  assigned_to INTEGER,
  image TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(assigned_to) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const admin = db.prepare("SELECT id FROM users WHERE email=?").get("admin@campus.local");
if (!admin) {
  const hash = bcrypt.hashSync("Admin@123", 10);
  db.prepare("INSERT INTO users(name,email,password,role,department) VALUES(?,?,?,?,?)")
    .run("Campus Administrator", "admin@campus.local", hash, "admin", "Administration");
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (/^image\/(jpeg|png|webp|jpg)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG and WEBP images are allowed"));
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadDir));
app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ message: "Authentication required" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || !payload.id) {
      return res.status(401).json({ message: "Invalid authentication token" });
    }
    const user = db.prepare("SELECT id, name, email, role, department FROM users WHERE id=?").get(payload.id);
    if (!user) {
      return res.status(401).json({ message: "User account not found. Please log in again." });
    }
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function roles(...allowed) {
  return (req, res, next) => {
    if (!allowed.includes(req.user.role)) return res.status(403).json({ message: "Access denied" });
    next();
  };
}

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, department: row.department };
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, department = "" } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password are required" });
    if (password.length < 6) return res.status(400).json({ message: "Password must contain at least 6 characters" });
    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare("INSERT INTO users(name,email,password,role,department) VALUES(?,?,?,?,?)")
      .run(name.trim(), email.trim().toLowerCase(), hash, "student", department.trim());
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token, user: publicUser(user) });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ message: "Email already registered" });
    res.status(500).json({ message: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(String(email).trim().toLowerCase());
    if (!user || !(await bcrypt.compare(String(password), user.password)))
      return res.status(401).json({ message: "Invalid email or password" });
    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    res.status(500).json({ message: "Login failed. Please try again." });
  }
});

app.get("/api/auth/me", auth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user?.id);
  if (!user) {
    return res.status(401).json({ message: "User account no longer exists. Please log in again." });
  }
  res.json({ user: publicUser(user) });
});

app.get("/api/issues", auth, (req, res) => {
  const { status, category, priority, search } = req.query;
  let sql = `
    SELECT i.*, u.name AS student_name, s.name AS assignee_name
    FROM issues i
    JOIN users u ON u.id=i.student_id
    LEFT JOIN users s ON s.id=i.assigned_to
    WHERE 1=1`;
  const params = [];
  if (req.user.role === "student") { sql += " AND i.student_id=?"; params.push(req.user.id); }
  if (status) { sql += " AND i.status=?"; params.push(status); }
  if (category) { sql += " AND i.category=?"; params.push(category); }
  if (priority) { sql += " AND i.priority=?"; params.push(priority); }
  if (search) {
    sql += " AND (i.title LIKE ? OR i.description LIKE ? OR i.location LIKE ?)";
    const q = `%${search}%`; params.push(q, q, q);
  }
  sql += " ORDER BY datetime(i.created_at) DESC";
  res.json(db.prepare(sql).all(...params));
});

app.get("/api/issues/:id", auth, (req, res) => {
  const issue = db.prepare(`
    SELECT i.*, u.name AS student_name, u.email AS student_email,
           s.name AS assignee_name
    FROM issues i JOIN users u ON u.id=i.student_id
    LEFT JOIN users s ON s.id=i.assigned_to
    WHERE i.id=?`).get(req.params.id);
  if (!issue) return res.status(404).json({ message: "Issue not found" });
  if (req.user.role === "student" && issue.student_id !== req.user.id)
    return res.status(403).json({ message: "Access denied" });
  const comments = db.prepare(`
    SELECT c.*, u.name AS user_name, u.role AS user_role
    FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.issue_id=? ORDER BY datetime(c.created_at) ASC`).all(req.params.id);
  res.json({ issue, comments });
});

app.post("/api/issues", auth, roles("student"), upload.single("image"), (req, res) => {
  const { title, description, category, location, priority = "Medium" } = req.body;
  if (!title || !description || !category || !location)
    return res.status(400).json({ message: "Title, description, category and location are required" });
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  const result = db.prepare(`
    INSERT INTO issues(title,description,category,location,priority,student_id,image)
    VALUES(?,?,?,?,?,?,?)`).run(title.trim(), description.trim(), category, location.trim(), priority, req.user.id, image);
  res.status(201).json({ id: result.lastInsertRowid, message: "Issue reported successfully" });
});

app.patch("/api/issues/:id", auth, roles("admin","staff"), (req, res) => {
  const { status, priority, assigned_to } = req.body;
  const issue = db.prepare("SELECT * FROM issues WHERE id=?").get(req.params.id);
  if (!issue) return res.status(404).json({ message: "Issue not found" });
  const newStatus = status || issue.status;
  const newPriority = priority || issue.priority;
  const assignee = assigned_to === "" || assigned_to === null ? null : (assigned_to ?? issue.assigned_to);
  db.prepare("UPDATE issues SET status=?, priority=?, assigned_to=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(newStatus, newPriority, assignee, req.params.id);
  res.json({ message: "Issue updated" });
});

app.post("/api/issues/:id/comments", auth, (req, res) => {
  const { message } = req.body;
  const issue = db.prepare("SELECT * FROM issues WHERE id=?").get(req.params.id);
  if (!issue) return res.status(404).json({ message: "Issue not found" });
  if (req.user.role === "student" && issue.student_id !== req.user.id)
    return res.status(403).json({ message: "Access denied" });
  if (!message?.trim()) return res.status(400).json({ message: "Comment cannot be empty" });
  db.prepare("INSERT INTO comments(issue_id,user_id,message) VALUES(?,?,?)")
    .run(req.params.id, req.user.id, message.trim());
  res.status(201).json({ message: "Comment added" });
});

app.get("/api/users/staff", auth, roles("admin"), (req, res) => {
  res.json(db.prepare("SELECT id,name,email,role,department FROM users WHERE role IN ('staff','admin') ORDER BY name").all());
});

app.post("/api/users/staff", auth, roles("admin"), async (req, res) => {
  const { name, email, password, department = "" } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password are required" });
  try {
    const hash = await bcrypt.hash(password, 10);
    db.prepare("INSERT INTO users(name,email,password,role,department) VALUES(?,?,?,?,?)")
      .run(name.trim(), email.trim().toLowerCase(), hash, "staff", department.trim());
    res.status(201).json({ message: "Staff account created" });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ message: "Email already registered" });
    res.status(500).json({ message: e.message });
  }
});

app.get("/api/dashboard", auth, (req, res) => {
  const where = req.user.role === "student" ? "WHERE student_id=?" : "";
  const params = req.user.role === "student" ? [req.user.id] : [];
  const total = db.prepare(`SELECT COUNT(*) c FROM issues ${where}`).get(...params).c;
  const pending = db.prepare(`SELECT COUNT(*) c FROM issues ${where} ${where ? "AND" : "WHERE"} status IN ('Pending','Assigned')`).get(...params).c;
  const progress = db.prepare(`SELECT COUNT(*) c FROM issues ${where} ${where ? "AND" : "WHERE"} status='In Progress'`).get(...params).c;
  const resolved = db.prepare(`SELECT COUNT(*) c FROM issues ${where} ${where ? "AND" : "WHERE"} status='Resolved'`).get(...params).c;
  res.json({ total, pending, progress, resolved });
});


// ---------------- AI FEATURES ----------------
function localAIAnalyze(title = "", description = "", category = "") {
  const text = `${title} ${description} ${category}`.toLowerCase();
  let suggestedCategory = category || "Other";
  if (/fan|light|switch|power|electric|socket|plug|current|wire/.test(text)) suggestedCategory = "Electrical";
  else if (/water|tap|pipe|toilet|leak|washroom|drain/.test(text)) suggestedCategory = "Plumbing";
  else if (/wifi|wi-fi|internet|network|router|connection/.test(text)) suggestedCategory = "Internet";
  else if (/clean|garbage|waste|dust|dirty|toilet/.test(text)) suggestedCategory = "Cleanliness";
  else if (/road|wall|door|window|desk|chair|ceiling|building|classroom|bench/.test(text)) suggestedCategory = "Infrastructure";
  else if (/fire|smoke|danger|accident|security|unsafe|emergency/.test(text)) suggestedCategory = "Safety";

  let priority = "Medium";
  if (/fire|smoke|accident|danger|emergency|electric shock|sparking/.test(text)) priority = "Urgent";
  else if (/not working|broken|leak|no internet|overflow|unsafe/.test(text)) priority = "High";
  else if (/minor|small|cosmetic/.test(text)) priority = "Low";

  const summary = description.trim()
    ? description.trim().replace(/\s+/g, " ").slice(0, 240) + (description.trim().length > 240 ? "..." : "")
    : "No description provided.";

  const suggestions = {
    Electrical: "Check the power source and isolate the affected equipment. Assign the electrical maintenance team.",
    Plumbing: "Inspect the affected pipe, tap, drain, or fixture and assign the plumbing team.",
    Internet: "Check the local network equipment, connectivity, and access point status.",
    Cleanliness: "Assign housekeeping and verify the area after cleaning.",
    Infrastructure: "Inspect the affected facility and schedule maintenance or repair.",
    Safety: "Treat this as a safety-sensitive report and notify the responsible campus team promptly.",
    Other: "Review the report and assign it to the most relevant campus support team."
  };

  return {
    category: suggestedCategory,
    priority,
    summary,
    recommendation: suggestions[suggestedCategory] || suggestions.Other,
    source: "local"
  };
}

async function callOpenAI(input) {
  if (!process.env.OPENAI_API_KEY) return null;
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      input
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "AI service request failed");
  return data.output_text || "";
}

app.post("/api/ai/analyze", auth, async (req, res) => {
  const { title = "", description = "", category = "", location = "" } = req.body || {};
  if (!title && !description) return res.status(400).json({ message: "Enter an issue title or description" });

  const fallback = localAIAnalyze(title, description, category);
  try {
    const aiText = await callOpenAI(`
You are the AI assistant for a college campus issue-management system.
Analyze this campus complaint and return concise JSON only with these keys:
category, priority, summary, recommendation.
category must be one of: Electrical, Plumbing, Cleanliness, Infrastructure, Internet, Safety, Other.
priority must be one of: Low, Medium, High, Urgent.
Do not invent facts. Treat the result as a suggestion for staff, not a final decision.

Title: ${title}
Description: ${description}
Existing category: ${category}
Location: ${location}
`);
    if (aiText) {
      try {
        const parsed = JSON.parse(aiText.replace(/^```json\s*|\s*```$/g, "").trim());
        return res.json({ ...fallback, ...parsed, source: "openai" });
      } catch {
        return res.json({ ...fallback, summary: aiText.slice(0, 1000), source: "openai" });
      }
    }
  } catch (e) {
    console.error("AI analyze:", e.message);
  }
  res.json(fallback);
});

app.post("/api/ai/chat", auth, async (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ message: "Enter a question" });

  const where = req.user.role === "student" ? "WHERE student_id=?" : "";
  const params = req.user.role === "student" ? [req.user.id] : [];
  const stats = db.prepare(`
    SELECT COUNT(*) total,
           SUM(CASE WHEN status='Resolved' THEN 1 ELSE 0 END) resolved,
           SUM(CASE WHEN status IN ('Pending','Assigned','In Progress') THEN 1 ELSE 0 END) open,
           SUM(CASE WHEN priority='Urgent' THEN 1 ELSE 0 END) urgent
    FROM issues ${where}`).get(...params);

  try {
    const aiText = await callOpenAI(`
You are Fix My Campus Assistant. Help users understand and use a campus issue-reporting system.
Be concise, friendly, and practical. Never claim to have performed an action unless the system actually did it.
Current user's role: ${req.user.role}
Current issue statistics: total=${stats.total || 0}, resolved=${stats.resolved || 0}, open=${stats.open || 0}, urgent=${stats.urgent || 0}
User question: ${message}
`);
    if (aiText) return res.json({ answer: aiText, source: "openai" });
  } catch (e) {
    console.error("AI chat:", e.message);
  }

  const lower = message.toLowerCase();
  let answer = "You can report a campus problem from the Report Issue button. Include a clear title, description, location, and priority.";
  if (lower.includes("status") || lower.includes("complaint")) {
    answer = `Your current dashboard has ${stats.total || 0} issue(s): ${stats.resolved || 0} resolved and ${stats.open || 0} still open.`;
  } else if (lower.includes("urgent") || lower.includes("priority")) {
    answer = `There are currently ${stats.urgent || 0} urgent issue(s) in your visible campus data.`;
  } else if (lower.includes("report") || lower.includes("create")) {
    answer = "To report an issue, use Report Issue, describe the problem clearly, select the category and priority, add the location, and attach a photo if useful.";
  }
  res.json({ answer, source: "local" });
});


app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ message: err.message || "Request failed" });
});

app.get("/api/analytics", auth, (req, res) => {
  const isStudent = req.user.role === "student";
  const where = isStudent ? "WHERE i.student_id=?" : "";
  const params = isStudent ? [req.user.id] : [];

  const status = db.prepare(`SELECT i.status AS label, COUNT(*) AS value FROM issues i ${where} GROUP BY i.status ORDER BY value DESC`).all(...params);
  const category = db.prepare(`SELECT i.category AS label, COUNT(*) AS value FROM issues i ${where} GROUP BY i.category ORDER BY value DESC`).all(...params);
  const priority = db.prepare(`SELECT i.priority AS label, COUNT(*) AS value FROM issues i ${where} GROUP BY i.priority ORDER BY value DESC`).all(...params);
  const location = db.prepare(`SELECT i.location AS label, COUNT(*) AS value FROM issues i ${where} GROUP BY i.location ORDER BY value DESC LIMIT 8`).all(...params);

  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', i.created_at) AS label, COUNT(*) AS value
    FROM issues i ${where}
    GROUP BY strftime('%Y-%m', i.created_at)
    ORDER BY label DESC LIMIT 6`).all(...params).reverse();

  const totals = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN i.status='Resolved' THEN 1 ELSE 0 END) AS resolved,
           SUM(CASE WHEN i.priority='Urgent' THEN 1 ELSE 0 END) AS urgent,
           SUM(CASE WHEN i.status IN ('Pending','Assigned','In Progress') AND julianday('now') - julianday(i.created_at) > 3 THEN 1 ELSE 0 END) AS overdue
    FROM issues i ${where}`).get(...params);

  const resolution = db.prepare(`
    SELECT AVG((julianday(i.updated_at) - julianday(i.created_at)) * 24.0) AS avg_hours
    FROM issues i ${where} ${where ? "AND" : "WHERE"} i.status='Resolved'`).get(...params);

  const topReporter = isStudent ? null : db.prepare(`
    SELECT u.name AS label, COUNT(*) AS value
    FROM issues i JOIN users u ON u.id=i.student_id
    GROUP BY i.student_id ORDER BY value DESC LIMIT 5`).all();

  res.json({
    totals: {
      total: totals.total || 0,
      resolved: totals.resolved || 0,
      urgent: totals.urgent || 0,
      overdue: totals.overdue || 0,
      resolutionRate: totals.total ? Math.round((totals.resolved / totals.total) * 100) : 0,
      avgResolutionHours: resolution.avg_hours ? Math.round(resolution.avg_hours * 10) / 10 : 0
    },
    status, category, priority, location, monthly, topReporter
  });
});

app.get("/api/reports/issues.csv", auth, (req, res) => {
  const isStudent = req.user.role === "student";
  const where = isStudent ? "WHERE i.student_id=?" : "";
  const params = isStudent ? [req.user.id] : [];
  const rows = db.prepare(`
    SELECT i.id, i.title, i.category, i.location, i.priority, i.status,
           u.name AS student, COALESCE(s.name,'Unassigned') AS assigned_staff,
           i.created_at, i.updated_at
    FROM issues i
    JOIN users u ON u.id=i.student_id
    LEFT JOIN users s ON s.id=i.assigned_to
    ${where}
    ORDER BY datetime(i.created_at) DESC`).all(...params);
  const fields = ['id','title','category','location','priority','status','student','assigned_staff','created_at','updated_at'];
  const csvEscape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [fields.join(','), ...rows.map(row => fields.map(f => csvEscape(row[f])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="fix-my-campus-issues.csv"');
  res.send(csv);
});

app.get("/api/health", (req, res) => res.json({ ok: true, service: "fix-my-campus" }));

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Fix My Campus running at http://localhost:${PORT}`));
