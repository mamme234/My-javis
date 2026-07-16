// backend/server.js - Premium JARVIS Backend
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
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const { google } = require('googleapis');
const SpotifyWebApi = require('spotify-web-api-node');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

// ============ INITIALIZATION ============
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
  }
});
const upload = multer({ dest: 'uploads/' });

// ============ MIDDLEWARE ============
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use('/uploads', express.static('uploads'));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ============ CLOUDINARY ============
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ============ AI INITIALIZATION ============
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

// User Model
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true, trim: true },
  email: { type: String, unique: true, required: true, lowercase: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '' },
  preferences: {
    theme: { type: String, default: 'dark' },
    language: { type: String, default: 'en' },
    voice: { type: String, default: 'alloy' },
    voiceSpeed: { type: Number, default: 1 },
    wakeWord: { type: String, default: 'Jarvis' },
    aiModel: { type: String, default: 'gpt-3.5-turbo' }
  },
  subscription: { type: String, default: 'free', enum: ['free', 'premium', 'enterprise'] },
  usage: {
    chats: { type: Number, default: 0 },
    tokens: { type: Number, default: 0 },
    images: { type: Number, default: 0 }
  },
  integrations: {
    spotify: { type: Object, default: {} },
    gmail: { type: Object, default: {} },
    googleCalendar: { type: Object, default: {} }
  },
  isAdmin: { type: Boolean, default: false },
  refreshToken: { type: String },
  createdAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now }
});

// Chat Model
const ChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'New Conversation' },
  messages: [{
    role: { type: String, enum: ['user', 'assistant', 'system'] },
    content: { type: String },
    timestamp: { type: Date, default: Date.now }
  }],
  model: { type: String, default: 'gpt-3.5-turbo' },
  tokens: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Memory Model
const MemorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed },
  type: { type: String, enum: ['preference', 'fact', 'context', 'long-term'], default: 'fact' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// File Model
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

// Note Model
const NoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  content: { type: String, default: '' },
  tags: [String],
  pinned: { type: Boolean, default: false },
  color: { type: String, default: '#1a1a2e' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Task Model
const TaskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  completed: { type: Boolean, default: false },
  dueDate: { type: Date },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  category: { type: String, default: 'General' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Reminder Model
const ReminderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  datetime: { type: Date, required: true },
  notified: { type: Boolean, default: false },
  repeat: { type: String, enum: ['none', 'daily', 'weekly', 'monthly'], default: 'none' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Chat = mongoose.model('Chat', ChatSchema);
const Memory = mongoose.model('Memory', MemorySchema);
const File = mongoose.model('File', FileSchema);
const Note = mongoose.model('Note', NoteSchema);
const Task = mongoose.model('Task', TaskSchema);
const Reminder = mongoose.model('Reminder', ReminderSchema);

// ============ AUTH MIDDLEWARE ============
const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    req.user = decoded;
    await User.findByIdAndUpdate(req.userId, { lastActive: new Date() });
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const admin = async (req, res, next) => {
  const user = await User.findById(req.userId);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ============ AI SERVICE ============
class AIService {
  constructor() {
    this.models = {
      'gpt-3.5-turbo': this.callOpenAI,
      'gpt-4': this.callOpenAI,
      'gemini-pro': this.callGemini,
      'claude': this.callClaude,
      'deepseek': this.callDeepSeek
    };
  }

  async callOpenAI(messages, model = 'gpt-3.5-turbo') {
    const response = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 2000
    });
    return response.choices[0].message.content;
  }

  async callGemini(messages) {
    const model = gemini.getGenerativeModel({ model: 'gemini-pro' });
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  async callClaude(messages) {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-opus-20240229',
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: 2000
    }, {
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    });
    return response.data.content[0].text;
  }

  async callDeepSeek(messages) {
    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages,
      temperature: 0.7,
      max_tokens: 2000
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.choices[0].message.content;
  }

  async chat(userId, messages, model = 'gpt-3.5-turbo') {
    // Get user memory
    const memories = await Memory.find({ 
      userId, 
      type: { $in: ['context', 'long-term'] }
    });
    const context = memories.map(m => `${m.key}: ${m.value}`).join('\n');

    // Build system prompt
    let systemPrompt = `You are JARVIS, an advanced AI assistant created to help users.
You are helpful, friendly, concise, and professional.
You have long-term memory and remember user preferences.
Current date: ${new Date().toISOString().split('T')[0]}`;

    if (context) {
      systemPrompt += `\n\nUser context:\n${context}`;
    }

    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    const handler = this.models[model] || this.callOpenAI;
    const response = await handler.call(this, fullMessages, model);

    // Save to chat history
    let chat = await Chat.findOne({ userId }).sort({ updatedAt: -1 });
    if (!chat) {
      chat = new Chat({ userId, messages: [] });
    }

    messages.forEach(msg => {
      chat.messages.push({ role: msg.role, content: msg.content, timestamp: new Date() });
    });
    chat.messages.push({ role: 'assistant', content: response, timestamp: new Date() });
    chat.updatedAt = new Date();
    chat.model = model;
    await chat.save();

    await User.findByIdAndUpdate(userId, {
      $inc: { 'usage.chats': 1, 'usage.tokens': messages.length + 1 }
    });

    return response;
  }

  async streamChat(userId, messages, model = 'gpt-3.5-turbo') {
    const memories = await Memory.find({ 
      userId, 
      type: { $in: ['context', 'long-term'] }
    });
    const context = memories.map(m => `${m.key}: ${m.value}`).join('\n');

    let systemPrompt = `You are JARVIS, an advanced AI assistant.
You are helpful, friendly, concise, and professional.
Current date: ${new Date().toISOString().split('T')[0]}`;

    if (context) {
      systemPrompt += `\n\nUser context:\n${context}`;
    }

    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    const stream = await openai.chat.completions.create({
      model,
      messages: fullMessages,
      temperature: 0.7,
      max_tokens: 2000,
      stream: true
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullContent += content;
        yield content;
      }
    }

    // Save chat after streaming
    let chat = await Chat.findOne({ userId }).sort({ updatedAt: -1 });
    if (!chat) {
      chat = new Chat({ userId, messages: [] });
    }

    messages.forEach(msg => {
      chat.messages.push({ role: msg.role, content: msg.content, timestamp: new Date() });
    });
    chat.messages.push({ role: 'assistant', content: fullContent, timestamp: new Date() });
    chat.updatedAt = new Date();
    chat.model = model;
    await chat.save();

    await User.findByIdAndUpdate(userId, {
      $inc: { 'usage.chats': 1, 'usage.tokens': messages.length + 1 }
    });
  }

  async generateImage(prompt) {
    const response = await openai.images.generate({
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard'
    });
    return response.data[0].url;
  }

  async analyzeImage(imageUrl) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-vision-preview',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image in detail:' },
          { type: 'image_url', image_url: imageUrl }
        ]
      }],
      max_tokens: 500
    });
    return response.choices[0].message.content;
  }

  async analyzePDF(text) {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a document analyzer. Summarize and analyze the following text.' },
        { role: 'user', content: text.substring(0, 3000) }
      ],
      max_tokens: 1000
    });
    return response.choices[0].message.content;
  }

  async webSearch(query) {
    try {
      const response = await axios.get(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`
      );
      return response.data;
    } catch (error) {
      // Fallback to OpenAI
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a search assistant. Provide information about the query.' },
          { role: 'user', content: query }
        ]
      });
      return { AbstractText: response.choices[0].message.content };
    }
  }
}

// ============ ROUTES ============

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ===== AUTH ROUTES =====

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({
      username,
      email: email.toLowerCase(),
      password: hashed,
      isAdmin: email === 'admin@jarvis.com'
    });
    await user.save();

    const token = jwt.sign(
      { id: user._id, email: user.email, isAdmin: user.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        subscription: user.subscription,
        isAdmin: user.isAdmin,
        preferences: user.preferences
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, isAdmin: user.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    await User.findByIdAndUpdate(user._id, { lastActive: new Date() });

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        subscription: user.subscription,
        isAdmin: user.isAdmin,
        preferences: user.preferences,
        usage: user.usage
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', auth, async (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// ===== USER ROUTES =====

app.get('/api/user/profile', auth, async (req, res) => {
  const user = await User.findById(req.userId)
    .select('-password -refreshToken');
  res.json(user);
});

app.put('/api/user/profile', auth, async (req, res) => {
  const updates = req.body;
  delete updates.password;
  delete updates._id;
  delete updates.email;
  delete updates.isAdmin;

  const user = await User.findByIdAndUpdate(
    req.userId,
    updates,
    { new: true, runValidators: true }
  ).select('-password -refreshToken');
  res.json(user);
});

app.post('/api/user/avatar', auth, upload.single('avatar'), async (req, res) => {
  const result = await cloudinary.uploader.upload(req.file.path, {
    folder: 'jarvis/avatars',
    width: 200,
    height: 200,
    crop: 'fill'
  });
  await User.findByIdAndUpdate(req.userId, { avatar: result.secure_url });
  fs.unlink(req.file.path, () => {});
  res.json({ avatar: result.secure_url });
});

// ===== CHAT ROUTES =====

const aiService = new AIService();

app.post('/api/chat', auth, async (req, res) => {
  try {
    const { messages, model = 'gpt-3.5-turbo' } = req.body;
    const response = await aiService.chat(req.userId, messages, model);
    res.json({ content: response });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat/stream', auth, async (req, res) => {
  try {
    const { messages, model = 'gpt-3.5-turbo' } = req.body;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = aiService.streamChat(req.userId, messages, model);
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

app.get('/api/chat/history', auth, async (req, res) => {
  const chats = await Chat.find({ userId: req.userId })
    .sort({ updatedAt: -1 })
    .limit(50);
  res.json(chats);
});

app.get('/api/chat/:chatId', auth, async (req, res) => {
  const chat = await Chat.findOne({
    _id: req.params.chatId,
    userId: req.userId
  });
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  res.json(chat);
});

app.delete('/api/chat/:chatId', auth, async (req, res) => {
  await Chat.deleteOne({ _id: req.params.chatId, userId: req.userId });
  res.json({ message: 'Chat deleted' });
});

// ===== MEMORY ROUTES =====

app.get('/api/memory', auth, async (req, res) => {
  const memories = await Memory.find({ userId: req.userId });
  res.json(memories);
});

app.post('/api/memory', auth, async (req, res) => {
  const { key, value, type = 'fact' } = req.body;
  const memory = await Memory.findOneAndUpdate(
    { userId: req.userId, key },
    { value, type, updatedAt: new Date() },
    { new: true, upsert: true }
  );
  res.json(memory);
});

app.delete('/api/memory/:id', auth, async (req, res) => {
  await Memory.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ message: 'Memory deleted' });
});

// ===== AI TOOLS =====

app.post('/api/tools/generate-image', auth, async (req, res) => {
  try {
    const { prompt } = req.body;
    const url = await aiService.generateImage(prompt);
    await User.findByIdAndUpdate(req.userId, { $inc: { 'usage.images': 1 } });
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tools/analyze-image', auth, upload.single('image'), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(req.file.path);
    const analysis = await aiService.analyzeImage(result.secure_url);
    fs.unlink(req.file.path, () => {});
    res.json({ analysis });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tools/generate-code', auth, async (req, res) => {
  try {
    const { prompt, language = 'javascript' } = req.body;
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: `Generate ${language} code. Only return code.` },
        { role: 'user', content: prompt }
      ]
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
      messages: [
        { role: 'system', content: 'Summarize concisely.' },
        { role: 'user', content: text }
      ]
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
      messages: [
        { role: 'system', content: `Translate to ${targetLang}. Only return translation.` },
        { role: 'user', content: text }
      ]
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
      messages: [
        { role: 'system', content: 'Fix grammar. Only return corrected text.' },
        { role: 'user', content: text }
      ]
    });
    res.json({ fixed: response.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tools/email-writer', auth, async (req, res) => {
  try {
    const { prompt } = req.body;
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Write professional email with subject, body, and closing.' },
        { role: 'user', content: prompt }
      ]
    });
    res.json({ email: response.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tools/web-search', auth, async (req, res) => {
  try {
    const { query } = req.body;
    const result = await aiService.webSearch(query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== FILE ROUTES =====

app.post('/api/files/upload', auth, upload.single('file'), async (req, res) => {
  try {
    let extractedText = '';
    
    // Extract text from PDF
    if (req.file.mimetype === 'application/pdf') {
      const dataBuffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(dataBuffer);
      extractedText = pdfData.text;
    }

    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'jarvis/files',
      resource_type: 'auto'
    });

    const file = new File({
      userId: req.userId,
      filename: result.public_id,
      originalName: req.file.originalname,
      path: result.secure_url,
      size: req.file.size,
      type: req.file.mimetype,
      extractedText
    });

    await file.save();
    fs.unlink(req.file.path, () => {});
    res.json(file);
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/files', auth, async (req, res) => {
  const files = await File.find({ userId: req.userId }).sort({ createdAt: -1 });
  res.json(files);
});

app.delete('/api/files/:id', auth, async (req, res) => {
  const file = await File.findOne({ _id: req.params.id, userId: req.userId });
  if (file) {
    await cloudinary.uploader.destroy(file.filename);
    await file.deleteOne();
  }
  res.json({ message: 'File deleted' });
});

app.post('/api/files/analyze/:id', auth, async (req, res) => {
  try {
    const file = await File.findOne({ _id: req.params.id, userId: req.userId });
    if (!file) return res.status(404).json({ error: 'File not found' });
    
    const analysis = await aiService.analyzePDF(file.extractedText);
    res.json({ analysis });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== NOTES ROUTES =====

app.get('/api/notes', auth, async (req, res) => {
  const notes = await Note.find({ userId: req.userId })
    .sort({ pinned: -1, updatedAt: -1 });
  res.json(notes);
});

app.post('/api/notes', auth, async (req, res) => {
  const { title, content, tags, color } = req.body;
  const note = new Note({ userId: req.userId, title, content, tags, color });
  await note.save();
  res.json(note);
});

app.put('/api/notes/:id', auth, async (req, res) => {
  const note = await Note.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    req.body,
    { new: true }
  );
  res.json(note);
});

app.delete('/api/notes/:id', auth, async (req, res) => {
  await Note.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ message: 'Note deleted' });
});

// ===== TASKS ROUTES =====

app.get('/api/tasks', auth, async (req, res) => {
  const tasks = await Task.find({ userId: req.userId })
    .sort({ completed: 1, dueDate: 1, priority: -1 });
  res.json(tasks);
});

app.post('/api/tasks', auth, async (req, res) => {
  const { title, description, dueDate, priority, category } = req.body;
  const task = new Task({
    userId: req.userId,
    title,
    description,
    dueDate: dueDate ? new Date(dueDate) : null,
    priority: priority || 'medium',
    category: category || 'General'
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
  res.json(task);
});

app.delete('/api/tasks/:id', auth, async (req, res) => {
  await Task.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ message: 'Task deleted' });
});

// ===== REMINDERS =====

app.get('/api/reminders', auth, async (req, res) => {
  const reminders = await Reminder.find({
    userId: req.userId,
    notified: false
  }).sort({ datetime: 1 });
  res.json(reminders);
});

app.post('/api/reminders', auth, async (req, res) => {
  const { title, description, datetime, repeat } = req.body;
  const reminder = new Reminder({
    userId: req.userId,
    title,
    description,
    datetime: new Date(datetime),
    repeat: repeat || 'none'
  });
  await reminder.save();
  res.json(reminder);
});

app.delete('/api/reminders/:id', auth, async (req, res) => {
  await Reminder.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ message: 'Reminder deleted' });
});

// ===== WEATHER =====

app.get('/api/weather', auth, async (req, res) => {
  try {
    const { city = 'London' } = req.query;
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${process.env.WEATHER_API_KEY}&units=metric`
    );
    res.json({
      temp: Math.round(response.data.main.temp),
      feelsLike: Math.round(response.data.main.feels_like),
      description: response.data.weather[0].description,
      humidity: response.data.main.humidity,
      windSpeed: response.data.wind.speed,
      icon: response.data.weather[0].icon,
      city: response.data.name,
      country: response.data.sys.country
    });
  } catch (error) {
    res.status(500).json({ error: 'Weather service unavailable' });
  }
});

// ===== VOICE =====

app.post('/api/voice/text-to-speech', auth, async (req, res) => {
  try {
    const { text, voice = 'alloy', speed = 1 } = req.body;
    const response = await axios.post(
      'https://api.openai.com/v1/audio/speech',
      {
        model: 'tts-1',
        input: text,
        voice: voice,
        speed: speed
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(response.data);
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ error: 'Text-to-speech failed' });
  }
});

app.post('/api/voice/speech-to-text', auth, upload.single('audio'), async (req, res) => {
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(req.file.path));
    formData.append('model', 'whisper-1');

    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders()
        }
      }
    );

    fs.unlink(req.file.path, () => {});
    res.json({ text: response.data.text });
  } catch (error) {
    console.error('STT error:', error);
    res.status(500).json({ error: 'Speech-to-text failed' });
  }
});

// ===== SPOTIFY =====

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

app.post('/api/spotify/play', auth, async (req, res) => {
  try {
    const { track, uri } = req.body;
    // Spotify integration logic
    await spotifyApi.play({
      uris: [uri || `spotify:track:${track}`]
    });
    res.json({ message: 'Playing...' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/spotify/search', auth, async (req, res) => {
  try {
    const { query } = req.query;
    const response = await spotifyApi.searchTracks(query);
    res.json(response.body);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== GMAIL =====

const gmail = google.gmail({
  version: 'v1',
  auth: new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  )
});

app.post('/api/gmail/send', auth, async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    const email = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      body
    ].join('\n');

    const encodedMessage = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage }
    });

    res.json({ message: 'Email sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== ADMIN ROUTES =====

app.get('/api/admin/users', auth, admin, async (req, res) => {
  const users = await User.find()
    .select('-password -refreshToken')
    .sort({ createdAt: -1 });
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

  res.json({
    totalUsers,
    totalChats,
    totalNotes,
    totalTasks,
    totalFiles
  });
});

app.put('/api/admin/users/:id', auth, admin, async (req, res) => {
  const { subscription, isAdmin, preferences } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { subscription, isAdmin, preferences },
    { new: true }
  ).select('-password -refreshToken');
  res.json(user);
});

app.delete('/api/admin/users/:id', auth, admin, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: 'User deleted' });
});

// ===== CRON JOBS =====

// Check reminders every minute
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const reminders = await Reminder.find({
    datetime: { $lte: now },
    notified: false
  });

  for (const reminder of reminders) {
    // Send notification via socket
    io.emit('notification', {
      userId: reminder.userId,
      title: reminder.title,
      description: reminder.description
    });
    reminder.notified = true;
    await reminder.save();
  }
});

// ===== SOCKET.IO =====

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
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

  socket.on('chat-message', async (data) => {
    try {
      const { messages, model } = data;
      const stream = aiService.streamChat(socket.userId, messages, model);
      
      for await (const chunk of stream) {
        socket.emit('chat-chunk', { content: chunk });
      }
      socket.emit('chat-end', {});
    } catch (error) {
      socket.emit('chat-error', { error: error.message });
    }
  });

  socket.on('typing', (data) => {
    socket.broadcast.emit('typing', { userId: socket.userId, isTyping: data.isTyping });
  });

  socket.on('disconnect', () => {
    console.log('🔴 Socket disconnected:', socket.userId);
  });
});

// ============ START SERVER ============

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 JARVIS Premium Backend running on port ${PORT}`);
  console.log(`🔌 WebSocket running on ws://0.0.0.0:${PORT}`);
  console.log(`📊 API endpoints available at /api/*`);
  console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET ? '✅ Set' : '❌ Not set'}`);
  console.log(`📦 MongoDB: ${mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Disconnected'}`);
  console.log(`🤖 OpenAI: ${process.env.OPENAI_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🎵 Spotify: ${process.env.SPOTIFY_CLIENT_ID ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`📧 Gmail: ${process.env.GMAIL_CLIENT_ID ? '✅ Configured' : '❌ Not configured'}`);
});

// ============ GRACEFUL SHUTDOWN ============

process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down gracefully...');
  await mongoose.disconnect();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
