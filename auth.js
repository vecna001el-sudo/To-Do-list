const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./database");
const { JWT_SECRET, authenticate } = require("./middleware");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: "All fields required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  try {
    const hashed = await bcrypt.hash(password, 12);
    const stmt = db.prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)");
    const result = stmt.run(username.trim(), email.toLowerCase().trim(), hashed);
    const token = jwt.sign({ id: result.lastInsertRowid, username, email }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token, user: { id: result.lastInsertRowid, username, email } });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Username or email already exists" });
    } else {
      res.status(500).json({ error: "Server error" });
    }
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
});

router.get("/me", authenticate, (req, res) => {
  const user = db.prepare("SELECT id, username, email, created_at FROM users WHERE id = ?").get(req.user.id);
  res.json(user);
});

router.put("/password", authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Both passwords required" });
  if (newPassword.length < 6)
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) return res.status(401).json({ error: "Current password incorrect" });
  const hashed = await bcrypt.hash(newPassword, 12);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashed, req.user.id);
  res.json({ message: "Password updated successfully" });
});

module.exports = router;
