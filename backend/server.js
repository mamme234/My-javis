// backend/server.js - Fixed Premium Version
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { OpenAI } = require('openai');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const pdfParse = require('pdf-parse');
const fs = require('fs');

// ============ INIT ============
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }
});
const upload = multer({ dest: 'uploads/' });

// ============ MIDDLEWARE ============
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// ============ CLOUDINARY ============
if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

// ============ OPENAI ============
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============ DATABASE ============
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => {
  console.error('❌ MongoDB error:', err);
  process.exit(1);
});

// ============ MODELS ============
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true, trim: true },
  email: { type: String, unique: true, required: true, lowercase: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '' },
  preferences: {
    theme: { type: String, default: 'dark' },
    language: { type: String, default: 'en' },
    voice: { type: String, default: 'alloy' },
    aiModel: { type: String, default: 'gpt-3.5-turbo' }
  },
  subscription: { type: String, default: 'free' },
  usage: { chats: { type: Number, default: 0 }, tokens: { type: Number, default: 0 } },
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const ChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'New Chat' },
  messages: [{
    role: { type: String, enum: ['user', 'assistant', 'system'] },
    content: { type: String },
    timestamp: { type: Date, default: Date.now }
  }],
  model: { type: String, default: 'gpt-3.5-turbo' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const MemorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed },
  type: { type: String, default: 'fact' },
  createdAt: { type: Date, default: Date.now }
});

const NoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  content: { type: String, default: '' },
  tags: [String],
  pinned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const TaskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  completed: { type: Boolean, default: false },
  dueDate: { type: Date },
  priority: { type: String, default: 'medium' },
  createdAt: { type: Date, default: Date.now }
});

const ReminderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  datetime: { type: Date, required: true },
  notified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const FileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  path: { type: String, required: true },
  size: { type: Number },
  type: { type: String },
  extractedText: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Chat = mongoose.model('Chat', ChatSchema);
const Memory = mongoose.model('Memory', MemorySchema);
const Note = mongoose.model('Note', NoteSchema);
const Task = mongoose.model('Task', TaskSchema);
const Reminder = mongoose.model('Reminder', ReminderSchema);
const File = mongoose.model('File', FileSchema);

// ============ AUTH ============
const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const admin = async (req, res, next) => {
  const user = await User.findById(req.userId);
  if (!user?.isAdmin) return res.status(403).json({ error: 'Admin required' });
  next();
};

// ============ ROUTES ============

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ===== AUTH =====
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) return res.status(400).json({ error: 'User exists' });
    
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ username, email: email.toLowerCase(), password: hashed });
    await user.save();
    
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, username, email, avatar: user.avatar } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, username: user.username, email: user.email, avatar: user.avatar } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', auth, async (req, res) => {
  res.json({ message: 'Logged out' });
});

// ===== USER =====
app.get('/api/user/profile', auth, async (req, res) => {
  const user = await User.findById(req.userId).select('-password');
  res.json(user);
});

app.put('/api/user/profile', auth, async (req, res) => {
  const user = await User.findByIdAndUpdate(req.userId, req.body, { new: true }).select('-password');
  res.json(user);
});

app.post('/api/user/avatar', auth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  let avatarUrl = '';
  if (process.env.CLOUDINARY_CLOUD_NAME) {
    const result = await cloudinary.uploader.upload(req.file.path);
    avatarUrl = result.secure_url;
  } else {
    avatarUrl = `/uploads/${req.file.filename}`;
  }
  await User.findByIdAndUpdate(req.userId, { avatar: avatarUrl });
  fs.unlink(req.file.path, () => {});
  res.json({ avatar: avatarUrl });
});

// ===== CHAT =====
app.post('/api/chat', auth, async (req, res) => {
  try {
    const { messages, model = 'gpt-3.5-turbo' } = req.body;
    
    const memories = await Memory.find({ userId: req.userId });
    const context = memories.map(m => `${m.key}: ${m.value}`).join('\n');
    
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: `You are JARVIS. Context: ${context}` },
        ...messages
      ]
    });
    
    let chat = await Chat.findOne({ userId: req.userId }).sort({ updatedAt: -1 });
    if (!chat) chat = new Chat({ userId: req.userId, messages: [] });
    messages.forEach(msg => chat.messages.push(msg));
    chat.messages.push({ role: 'assistant', content: response.choices[0].message.content });
    chat.updatedAt = new Date();
    await chat.save();
    
    await User.findByIdAndUpdate(req.userId, { $inc: { 'usage.chats': 1 } });
    res.json(response.choices[0].message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat/stream', auth, async (req, res) => {
  try {
    const { messages, model = 'gpt-3.5-turbo' } = req.body;
    
    const memories = await Memory.find({ userId: req.userId });
    const context = memories.map(m => `${m.key}: ${m.value}`).join('\n');
    
    const stream = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: `You are JARVIS. Context: ${context}` },
        ...messages
      ],
      stream: true
    });
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

app.get('/api/chat/history', auth, async (req, res) => {
  const chats = await Chat.find({ userId: req.userId }).sort({ updatedAt: -1 });
  res.json(chats);
});

app.get('/api/chat/:chatId', auth, async (req, res) => {
  const chat = await Chat.findOne({ _id: req.params.chatId, userId: req.userId });
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  res.json(chat);
});

app.delete('/api/chat/:chatId', auth, async (req, res) => {
  await Chat.deleteOne({ _id: req.params.chatId, userId: req.userId });
  res.json({ success: true });
});

// ===== MEMORY =====
app.get('/api/memory', auth, async (req, res) => {
  const memories = await Memory.find({ userId: req.userId });
  res.json(memories);
});

app.post('/api/memory', auth, async (req, res) => {
  const { key, value } = req.body;
  const memory = await Memory.findOneAndUpdate(
    { userId: req.userId, key },
    { value },
    { new: true, upsert: true }
  );
  res.json(memory);
});

app.delete('/api/memory/:id', auth, async (req, res) => {
  await Memory.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ success: true });
});

app.delete('/api/memory', auth, async (req, res) => {
  await Memory.deleteMany({ userId: req.userId });
  res.json({ success: true });
});

// ===== NOTES =====
app.get('/api/notes', auth, async (req, res) => {
  const notes = await Note.find({ userId: req.userId }).sort({ updatedAt: -1 });
  res.json(notes);
});

app.post('/api/notes', auth, async (req, res) => {
  const { title, content, tags } = req.body;
  const note = new Note({ userId: req.userId, title, content: content || '', tags: tags || [] });
  await note.save();
  res.json(note);
});

app.put('/api/notes/:id', auth, async (req, res) => {
  const note = await Note.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    req.body,
    { new: true }
  );
  if (!note) return res.status(404).json({ error: 'Note not found' });
  res.json(note);
});

app.delete('/api/notes/:id', auth, async (req, res) => {
  await Note.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ success: true });
});

// ===== TASKS =====
app.get('/api/tasks', auth, async (req, res) => {
  const tasks = await Task.find({ userId: req.userId }).sort({ dueDate: 1 });
  res.json(tasks);
});

app.post('/api/tasks', auth, async (req, res) => {
  const { title, description, dueDate, priority } = req.body;
  const task = new Task({
    userId: req.userId,
    title,
    description: description || '',
    dueDate: dueDate ? new Date(dueDate) : null,
    priority: priority || 'medium'
  });
  await task.save();
  res.json(task);
});

app.put('/api/tasks/:id', auth, async (req, res) => {
  const task = await Task.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    req.body,
    { new: true }
  );
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.delete('/api/tasks/:id', auth, async (req, res) => {
  await Task.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ success: true });
});

// ===== REMINDERS =====
app.get('/api/reminders', auth, async (req, res) => {
  const reminders = await Reminder.find({ userId: req.userId, notified: false }).sort({ datetime: 1 });
  res.json(reminders);
});

app.post('/api/reminders', auth, async (req, res) => {
  const { title, datetime, description } = req.body;
  const reminder = new Reminder({
    userId: req.userId,
    title,
    datetime: new Date(datetime),
    description: description || ''
  });
  await reminder.save();
  res.json(reminder);
});

app.delete('/api/reminders/:id', auth, async (req, res) => {
  await Reminder.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ success: true });
});

// ===== AI TOOLS =====
app.post('/api/tools/generate-image', auth, async (req, res) => {
  try {
    const { prompt } = req.body;
    const response = await openai.images.generate({ prompt, n: 1, size: '1024x1024' });
    res.json({ url: response.data[0].url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tools/generate-code', auth, async (req, res) => {
  try {
    const { prompt, language = 'javascript' } = req.body;
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: `Generate ${language} code for: ${prompt}` }]
    });
    res.json({ code: response.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tools/summarize', auth, async (req, res) => {
  try {
    const { text } = req.body;
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: `Summarize: ${text}` }]
    });
    res.json({ summary: response.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tools/translate', auth, async (req, res) => {
  try {
    const { text, targetLang = 'Spanish' } = req.body;
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: `Translate to ${targetLang}: ${text}` }]
    });
    res.json({ translated: response.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tools/fix-grammar', auth, async (req, res) => {
  try {
    const { text } = req.body;
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: `Fix grammar: ${text}` }]
    });
    res.json({ fixed: response.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tools/web-search', auth, async (req, res) => {
  try {
    const { query } = req.body;
    // Simple web search using OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a search assistant. Provide helpful information about the query.' },
        { role: 'user', content: query }
      ]
    });
    res.json({ result: response.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== WEATHER =====
app.get('/api/weather', auth, async (req, res) => {
  try {
    const { city = 'London' } = req.query;
    if (!process.env.WEATHER_API_KEY) {
      // Fallback: use OpenAI
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: `What's the weather in ${city}?` }]
      });
      return res.json({ description: response.choices[0].message.content });
    }
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${process.env.WEATHER_API_KEY}&units=metric`
    );
    res.json({
      temp: Math.round(response.data.main.temp),
      description: response.data.weather[0].description,
      icon: response.data.weather[0].icon,
      humidity: response.data.main.humidity
    });
  } catch (error) {
    res.status(500).json({ error: 'Weather unavailable' });
  }
});

// ===== FILES =====
app.post('/api/files/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    
    let extractedText = '';
    if (req.file.mimetype === 'application/pdf') {
      const dataBuffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(dataBuffer);
      extractedText = pdfData.text;
    }

    let fileUrl = '';
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      const result = await cloudinary.uploader.upload(req.file.path);
      fileUrl = result.secure_url;
    } else {
      fileUrl = `/uploads/${req.file.filename}`;
    }

    const file = new File({
      userId: req.userId,
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: fileUrl,
      size: req.file.size,
      type: req.file.mimetype,
      extractedText
    });
    await file.save();
    fs.unlink(req.file.path, () => {});
    res.json(file);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/files', auth, async (req, res) => {
  const files = await File.find({ userId: req.userId }).sort({ createdAt: -1 });
  res.json(files);
});

app.delete('/api/files/:id', auth, async (req, res) => {
  await File.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ success: true });
});

// ===== ADMIN =====
app.get('/api/admin/users', auth, admin, async (req, res) => {
  const users = await User.find().select('-password');
  res.json(users);
});

app.get('/api/admin/stats', auth, admin, async (req, res) => {
  const [totalUsers, totalChats, totalNotes, totalTasks, totalFiles] = await Promise.all([
    User.countDocuments(),
    Chat.countDocuments(),
    Note.countDocuments(),
    Task.countDocuments(),
    File.countDocuments()
  ]);
  res.json({ totalUsers, totalChats, totalNotes, totalTasks, totalFiles });
});

app.put('/api/admin/users/:id', auth, admin, async (req, res) => {
  const { subscription, isAdmin } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { subscription, isAdmin },
    { new: true }
  ).select('-password');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.delete('/api/admin/users/:id', auth, admin, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ===== SOCKET.IO =====
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Auth required'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log('🟢 Socket connected:', socket.userId);
  
  socket.on('message', (data) => {
    io.emit('message', { userId: socket.userId, ...data });
  });
  
  socket.on('disconnect', () => {
    console.log('🔴 Socket disconnected:', socket.userId);
  });
});

// ============ START ============
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 JARVIS Premium running on port ${PORT}`);
  console.log(`📦 MongoDB: ${mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Disconnected'}`);
  console.log(`🤖 OpenAI: ${process.env.OPENAI_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
});
