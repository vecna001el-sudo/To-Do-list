const express = require("express");
const db = require("./database");
const { authenticate } = require("./middleware");

const router = express.Router();

router.get("/stats/summary", authenticate, (req, res) => {
  const total = db.prepare("SELECT COUNT(*) as count FROM todos WHERE user_id = ?").get(req.user.id).count;
  const completed = db.prepare("SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND completed = 1").get(req.user.id).count;
  const overdue = db.prepare("SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND completed = 0 AND due_date < datetime('now')").get(req.user.id).count;
  const dueToday = db.prepare("SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND completed = 0 AND date(due_date) = date('now')").get(req.user.id).count;
  res.json({ total, completed, active: total - completed, overdue, dueToday });
});

router.get("/reminders/due", authenticate, (req, res) => {
  const reminders = db.prepare(`
    SELECT * FROM todos
    WHERE user_id = ? AND completed = 0 AND reminder_sent = 0
    AND reminder_date <= datetime('now', '+1 minute')
    AND reminder_date >= datetime('now', '-10 minutes')
  `).all(req.user.id);
  if (reminders.length > 0) {
    const ids = reminders.map(r => r.id);
    db.prepare(`UPDATE todos SET reminder_sent = 1 WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  }
  res.json(reminders);
});

router.get("/", authenticate, (req, res) => {
  const { status, priority, category, search, sort } = req.query;
  let query = "SELECT * FROM todos WHERE user_id = ?";
  const params = [req.user.id];
  if (status === "completed") { query += " AND completed = 1"; }
  else if (status === "active") { query += " AND completed = 0"; }
  if (priority) { query += " AND priority = ?"; params.push(priority); }
  if (category) { query += " AND category = ?"; params.push(category); }
  if (search) { query += " AND (title LIKE ? OR description LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
  const sortMap = {
    "due_date": "due_date ASC",
    "priority": "CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END",
    "created": "created_at DESC",
    "title": "title ASC"
  };
  query += ` ORDER BY ${sortMap[sort] || "created_at DESC"}`;
  const todos = db.prepare(query).all(...params);
  res.json(todos);
});

router.get("/:id", authenticate, (req, res) => {
  const todo = db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!todo) return res.status(404).json({ error: "Todo not found" });
  res.json(todo);
});

router.post("/", authenticate, (req, res) => {
  const { title, description, priority, category, due_date, reminder_date } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Title is required" });
  const stmt = db.prepare(`INSERT INTO todos (user_id, title, description, priority, category, due_date, reminder_date) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const result = stmt.run(req.user.id, title.trim(), description || null, priority || "medium", category || "general", due_date || null, reminder_date || null);
  const todo = db.prepare("SELECT * FROM todos WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(todo);
});

router.put("/:id", authenticate, (req, res) => {
  const existing = db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: "Todo not found" });
  const { title, description, priority, category, due_date, reminder_date, completed } = req.body;
  db.prepare(`UPDATE todos SET title=?, description=?, priority=?, category=?, due_date=?, reminder_date=?, completed=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`)
    .run(
      title !== undefined ? title : existing.title,
      description !== undefined ? description : existing.description,
      priority !== undefined ? priority : existing.priority,
      category !== undefined ? category : existing.category,
      due_date !== undefined ? due_date : existing.due_date,
      reminder_date !== undefined ? reminder_date : existing.reminder_date,
      completed !== undefined ? (completed ? 1 : 0) : existing.completed,
      req.params.id, req.user.id
    );
  const updated = db.prepare("SELECT * FROM todos WHERE id = ?").get(req.params.id);
  res.json(updated);
});

router.patch("/:id/toggle", authenticate, (req, res) => {
  const todo = db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!todo) return res.status(404).json({ error: "Todo not found" });
  db.prepare("UPDATE todos SET completed=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(todo.completed ? 0 : 1, req.params.id);
  const updated = db.prepare("SELECT * FROM todos WHERE id = ?").get(req.params.id);
  res.json(updated);
});

router.delete("/bulk/completed", authenticate, (req, res) => {
  const result = db.prepare("DELETE FROM todos WHERE user_id = ? AND completed = 1").run(req.user.id);
  res.json({ message: `Deleted ${result.changes} completed todos` });
});

router.delete("/:id", authenticate, (req, res) => {
  const result = db.prepare("DELETE FROM todos WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: "Todo not found" });
  res.json({ message: "Deleted successfully" });
});

module.exports = router;
