// backend/server.js - Complete JARVIS Backend Server
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { OpenAI } = require('openai');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

// ============ INITIALIZATION ============
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static('uploads'));

// Rate limiting
const limiter = rateLimit({
  windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ============ CLOUDINARY ============
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ============ OPENAI ============
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============ DATABASE ============
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/jarvis', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('✅ MongoDB connected successfully'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

// ============ MODELS ============

// User Model
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true, trim: true, minlength: 3, maxlength: 30 },
  email: { type: String, unique: true, required: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '' },
  preferences: {
    theme: { type: String, default: 'dark', enum: ['dark', 'light'] },
    language: { type: String, default: 'en' },
    voice: { type: String, default: 'alloy' },
    wakeWord: { type: String, default: 'Jarvis' }
  },
  subscription: { type: String, default: 'free', enum: ['free', 'premium', 'enterprise'] },
  usage: {
    chats: { type: Number, default: 0 },
    tokens: { type: Number, default: 0 },
    images: { type: Number, default: 0 }
  },
  isAdmin: { type: Boolean, default: false },
  refreshToken: { type: String },
  emailVerified: { type: Boolean, default: false },
  verificationToken: { type: String },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  createdAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now }
});

// Chat Model
const ChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'New Chat' },
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
  type: { type: String, enum: ['preference', 'fact', 'context'], default: 'fact' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
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

// File Model
const FileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  path: { type: String, required: true },
  size: { type: Number },
  type: { type: String },
  folder: { type: String, default: '/' },
  createdAt: { type: Date, default: Date.now }
});

// API Key Model
const ApiKeySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  permissions: [String],
  lastUsed: { type: Date },
  expiresAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

// Session Model
const SessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  token: { type: String, required: true },
  device: { type: String, default: 'Unknown' },
  ip: { type: String },
  userAgent: { type: String },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Models
const User = mongoose.model('User', UserSchema);
const Chat = mongoose.model('Chat', ChatSchema);
const Memory = mongoose.model('Memory', MemorySchema);
const Note = mongoose.model('Note', NoteSchema);
const Task = mongoose.model('Task', TaskSchema);
const Reminder = mongoose.model('Reminder', ReminderSchema);
const File = mongoose.model('File', FileSchema);
const ApiKey = mongoose.model('ApiKey', ApiKeySchema);
const Session = mongoose.model('Session', SessionSchema);

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
    
    // Update last active
    await User.findByIdAndUpdate(req.userId, { lastActive: new Date() });
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const admin = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (error) {
    res.status(500).json({ error: 'Error checking admin status' });
  }
};

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

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Validate
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Check if user exists
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashed = await bcrypt.hash(password, 10);
    
    // Create user
    const user = new User({
      username,
      email: email.toLowerCase(),
      password: hashed,
      isAdmin: email === 'admin@jarvis.com' // Make first admin
    });
    await user.save();
    
    // Generate token
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
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
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
    
    // Generate token
    const token = jwt.sign(
      { id: user._id, email: user.email, isAdmin: user.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );
    
    // Update last active
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
        preferences: user.preferences
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/api/auth/logout', auth, async (req, res) => {
  try {
    // Clear any sessions
    await Session.deleteMany({ userId: req.userId });
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Refresh Token
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }
    
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const token = jwt.sign(
      { id: user._id, email: user.email, isAdmin: user.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );
    
    res.json({ token });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Forgot Password
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Generate reset token
    const resetToken = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = new Date(Date.now() + 3600000);
    await user.save();
    
    // In production, send email with reset link
    res.json({ message: 'Password reset email sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Reset Password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({
      _id: decoded.id,
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();
    
    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(400).json({ error: 'Invalid or expired token' });
  }
});

// Verify Email
app.post('/api/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    user.emailVerified = true;
    user.verificationToken = null;
    await user.save();
    
    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Invalid verification token' });
  }
});

// ===== USER ROUTES =====

// Get Profile
app.get('/api/user/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .select('-password -refreshToken -verificationToken -resetPasswordToken -resetPasswordExpires');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update Profile
app.put('/api/user/profile', auth, async (req, res) => {
  try {
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
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Upload Avatar
app.post('/api/user/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'jarvis/avatars',
      width: 200,
      height: 200,
      crop: 'fill'
    });
    
    await User.findByIdAndUpdate(req.userId, { avatar: result.secure_url });
    
    // Clean up temp file
    fs.unlink(req.file.path, () => {});
    
    res.json({ avatar: result.secure_url });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// ===== CHAT ROUTES =====

// Send Message
app.post('/api/chat', auth, async (req, res) => {
  try {
    const { messages, model = 'gpt-3.5-turbo' } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages required' });
    }
    
    // Get user memory
    const memories = await Memory.find({ userId: req.userId, type: 'context' });
    const context = memories.map(m => `${m.key}: ${m.value}`).join('\n');
    
    // Build system prompt
    let systemPrompt = `You are JARVIS, an advanced AI assistant. 
You are helpful, friendly, concise, and professional.
You remember previous conversations and adapt to the user's style.
Current date: ${new Date().toISOString().split('T')[0]}`;

    if (context) {
      systemPrompt += `\n\nUser context:\n${context}`;
    }
    
    // Call OpenAI
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 2000
    });
    
    const assistantMessage = response.choices[0].message;
    
    // Save chat
    let chat = await Chat.findOne({ userId: req.userId }).sort({ updatedAt: -1 });
    if (!chat) {
      chat = new Chat({ userId: req.userId, messages: [] });
    }
    
    // Add user messages
    messages.forEach(msg => {
      chat.messages.push({
        role: msg.role,
        content: msg.content,
        timestamp: new Date()
      });
    });
    
    // Add assistant message
    chat.messages.push({
      role: 'assistant',
      content: assistantMessage.content,
      timestamp: new Date()
    });
    
    chat.updatedAt = new Date();
    chat.tokens = (chat.tokens || 0) + (response.usage?.total_tokens || 0);
    await chat.save();
    
    // Update user usage
    await User.findByIdAndUpdate(req.userId, {
      $inc: {
        'usage.chats': 1,
        'usage.tokens': response.usage?.total_tokens || 0
      }
    });
    
    res.json(assistantMessage);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Chat failed' });
  }
});

// Stream Chat
app.post('/api/chat/stream', auth, async (req, res) => {
  try {
    const { messages, model = 'gpt-3.5-turbo' } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages required' });
    }
    
    // Get user memory
    const memories = await Memory.find({ userId: req.userId, type: 'context' });
    const context = memories.map(m => `${m.key}: ${m.value}`).join('\n');
    
    let systemPrompt = `You are JARVIS, an advanced AI assistant.
You are helpful, friendly, concise, and professional.
Current date: ${new Date().toISOString().split('T')[0]}`;

    if (context) {
      systemPrompt += `\n\nUser context:\n${context}`;
    }
    
    // Stream response
    const stream = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 2000,
      stream: true
    });
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    let fullContent = '';
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullContent += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
    
    // Save chat after streaming
    let chat = await Chat.findOne({ userId: req.userId }).sort({ updatedAt: -1 });
    if (!chat) {
      chat = new Chat({ userId: req.userId, messages: [] });
    }
    
    messages.forEach(msg => {
      chat.messages.push({
        role: msg.role,
        content: msg.content,
        timestamp: new Date()
      });
    });
    
    chat.messages.push({
      role: 'assistant',
      content: fullContent,
      timestamp: new Date()
    });
    
    chat.updatedAt = new Date();
    await chat.save();
    
    await User.findByIdAndUpdate(req.userId, {
      $inc: { 'usage.chats': 1 }
    });
    
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// Get Chat History
app.get('/api/chat/history', auth, async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.userId })
      .sort({ updatedAt: -1 })
      .limit(50);
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get chat history' });
  }
});

// Get Single Chat
app.get('/api/chat/:chatId', auth, async (req, res) => {
  try {
    const chat = await Chat.findOne({
      _id: req.params.chatId,
      userId: req.userId
    });
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    res.json(chat);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get chat' });
  }
});

// Delete Chat
app.delete('/api/chat/:chatId', auth, async (req, res) => {
  try {
    const result = await Chat.deleteOne({
      _id: req.params.chatId,
      userId: req.userId
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    res.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// Update Chat Title
app.put('/api/chat/:chatId/title', auth, async (req, res) => {
  try {
    const { title } = req.body;
    const chat = await Chat.findOneAndUpdate(
      { _id: req.params.chatId, userId: req.userId },
      { title },
      { new: true }
    );
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    res.json(chat);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update chat title' });
  }
});

// ===== MEMORY ROUTES =====

// Get Memories
app.get('/api/memory', auth, async (req, res) => {
  try {
    const memories = await Memory.find({ userId: req.userId });
    res.json(memories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get memories' });
  }
});

// Create Memory
app.post('/api/memory', auth, async (req, res) => {
  try {
    const { key, value, type = 'fact' } = req.body;
    
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Key and value required' });
    }
    
    // Update existing memory or create new
    const memory = await Memory.findOneAndUpdate(
      { userId: req.userId, key },
      { value, type, updatedAt: new Date() },
      { new: true, upsert: true }
    );
    
    res.json(memory);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save memory' });
  }
});

// Delete Memory
app.delete('/api/memory/:id', auth, async (req, res) => {
  try {
    const result = await Memory.deleteOne({
      _id: req.params.id,
      userId: req.userId
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Memory not found' });
    }
    
    res.json({ message: 'Memory deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

// Clear All Memories
app.delete('/api/memory', auth, async (req, res) => {
  try {
    await Memory.deleteMany({ userId: req.userId });
    res.json({ message: 'All memories cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear memories' });
  }
});

// ===== NOTES ROUTES =====

// Get Notes
app.get('/api/notes', auth, async (req, res) => {
  try {
    const notes = await Note.find({ userId: req.userId })
      .sort({ pinned: -1, updatedAt: -1 });
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get notes' });
  }
});

// Create Note
app.post('/api/notes', auth, async (req, res) => {
  try {
    const { title, content, tags, color } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Title required' });
    }
    
    const note = new Note({
      userId: req.userId,
      title,
      content: content || '',
      tags: tags || [],
      color: color || '#1a1a2e'
    });
    
    await note.save();
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// Update Note
app.put('/api/notes/:id', auth, async (req, res) => {
  try {
    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Delete Note
app.delete('/api/notes/:id', auth, async (req, res) => {
  try {
    const result = await Note.deleteOne({
      _id: req.params.id,
      userId: req.userId
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    res.json({ message: 'Note deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// ===== TASKS ROUTES =====

// Get Tasks
app.get('/api/tasks', auth, async (req, res) => {
  try {
    const { completed, priority, category } = req.query;
    const filter = { userId: req.userId };
    
    if (completed !== undefined) filter.completed = completed === 'true';
    if (priority) filter.priority = priority;
    if (category) filter.category = category;
    
    const tasks = await Task.find(filter)
      .sort({ completed: 1, dueDate: 1, priority: -1 });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get tasks' });
  }
});

// Create Task
app.post('/api/tasks', auth, async (req, res) => {
  try {
    const { title, description, dueDate, priority, category } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Title required' });
    }
    
    const task = new Task({
      userId: req.userId,
      title,
      description: description || '',
      dueDate: dueDate ? new Date(dueDate) : null,
      priority: priority || 'medium',
      category: category || 'General'
    });
    
    await task.save();
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Update Task
app.put('/api/tasks/:id', auth, async (req, res) => {
  try {
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Delete Task
app.delete('/api/tasks/:id', auth, async (req, res) => {
  try {
    const result = await Task.deleteOne({
      _id: req.params.id,
      userId: req.userId
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// ===== REMINDERS ROUTES =====

// Get Reminders
app.get('/api/reminders', auth, async (req, res) => {
  try {
    const reminders = await Reminder.find({
      userId: req.userId,
      notified: false
    }).sort({ datetime: 1 });
    res.json(reminders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get reminders' });
  }
});

// Create Reminder
app.post('/api/reminders', auth, async (req, res) => {
  try {
    const { title, description, datetime, repeat } = req.body;
    
    if (!title || !datetime) {
      return res.status(400).json({ error: 'Title and datetime required' });
    }
    
    const reminder = new Reminder({
      userId: req.userId,
      title,
      description: description || '',
      datetime: new Date(datetime),
      repeat: repeat || 'none'
    });
    
    await reminder.save();
    res.json(reminder);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

// Delete Reminder
app.delete('/api/reminders/:id', auth, async (req, res) => {
  try {
    const result = await Reminder.deleteOne({
      _id: req.params.id,
      userId: req.userId
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    
    res.json({ message: 'Reminder deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

// ===== AI TOOLS ROUTES =====

// Generate Image
app.post('/api/tools/generate-image', auth, async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt required' });
    }
    
    const response = await openai.images.generate({
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard'
    });
    
    // Update usage
    await User.findByIdAndUpdate(req.userId, {
      $inc: { 'usage.images': 1 }
    });
    
    res.json({ url: response.data[0].url });
  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ error: error.message || 'Image generation failed' });
  }
});

// Generate Code
app.post('/api/tools/generate-code', auth, async (req, res) => {
  try {
    const { prompt, language = 'javascript' } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt required' });
    }
    
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: `You are a code generator. Generate clean, well-commented ${language} code.` },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    });
    
    res.json({ code: response.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: 'Code generation failed' });
  }
});

// Summarize Text
app.post('/api/tools/summarize', auth, async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text required' });
    }
    
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a summarizer. Create a concise summary of the provided text.' },
        { role: 'user', content: text }
      ],
      temperature: 0.3
    });
    
    res.json({ summary: response.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: 'Summarization failed' });
  }
});

// Translate Text
app.post('/api/tools/translate', auth, async (req, res) => {
  try {
    const { text, targetLang = 'Spanish' } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text required' });
    }
    
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: `Translate to ${targetLang}. Only return the translation.` },
        { role: 'user', content: text }
      ],
      temperature: 0.3
    });
    
    res.json({ translated: response.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: 'Translation failed' });
  }
});

// Fix Grammar
app.post('/api/tools/fix-grammar', auth, async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text required' });
    }
    
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Fix grammar and spelling. Only return the corrected text.' },
        { role: 'user', content: text }
      ],
      temperature: 0.1
    });
    
    res.json({ fixed: response.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: 'Grammar fix failed' });
  }
});

// Write Email
app.post('/api/tools/email-writer', auth, async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt required' });
    }
    
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Write a professional email. Include subject, salutation, body, and closing.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.5
    });
    
    res.json({ email: response.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: 'Email writing failed' });
  }
});

// ===== WEATHER ROUTE =====

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

// ===== VOICE ROUTES =====

// Text to Speech
app.post('/api/voice/text-to-speech', auth, async (req, res) => {
  try {
    const { text, voice = 'alloy' } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text required' });
    }
    
    const response = await axios.post(
      'https://api.openai.com/v1/audio/speech',
      {
        model: 'tts-1',
        input: text,
        voice: voice
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

// Speech to Text
app.post('/api/voice/speech-to-text', auth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file required' });
    }
    
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
    
    // Clean up
    fs.unlink(req.file.path, () => {});
    
    res.json({ text: response.data.text });
  } catch (error) {
    console.error('STT error:', error);
    res.status(500).json({ error: 'Speech-to-text failed' });
  }
});

// ===== FILE ROUTES =====

// Upload File
app.post('/api/files/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
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
      type: req.file.mimetype
    });
    
    await file.save();
    
    // Clean up
    fs.unlink(req.file.path, () => {});
    
    res.json(file);
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// Get Files
app.get('/api/files', auth, async (req, res) => {
  try {
    const files = await File.find({ userId: req.userId })
      .sort({ createdAt: -1 });
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get files' });
  }
});

// Delete File
app.delete('/api/files/:id', auth, async (req, res) => {
  try {
    const file = await File.findOne({
      _id: req.params.id,
      userId: req.userId
    });
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Delete from cloudinary
    await cloudinary.uploader.destroy(file.filename);
    await file.deleteOne();
    
    res.json({ message: 'File deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// ===== ADMIN ROUTES =====

// Get All Users
app.get('/api/admin/users', auth, admin, async (req, res) => {
  try {
    const users = await User.find()
      .select('-password -refreshToken -verificationToken -resetPasswordToken -resetPasswordExpires')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Get User Stats
app.get('/api/admin/stats', auth, admin, async (req, res) => {
  try {
    const [totalUsers, totalChats, totalNotes, totalTasks, totalFiles] = await Promise.all([
      User.countDocuments(),
      Chat.countDocuments(),
      Note.countDocuments(),
      Task.countDocuments(),
      File.countDocuments()
    ]);
    
    // Get chat count per day (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const dailyChats = await Chat.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 }
      }},
      { $sort: { _id: 1 } }
    ]);
    
    res.json({
      totalUsers,
      totalChats,
      totalNotes,
      totalTasks,
      totalFiles,
      dailyChats
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Get User Usage
app.get('/api/admin/usage', auth, admin, async (req, res) => {
  try {
    const users = await User.find()
      .select('username email subscription usage createdAt')
      .sort({ 'usage.chats': -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get usage data' });
  }
});

// Update User
app.put('/api/admin/users/:id', auth, admin, async (req, res) => {
  try {
    const { subscription, isAdmin, preferences } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { subscription, isAdmin, preferences },
      { new: true }
    ).select('-password -refreshToken');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete User
app.delete('/api/admin/users/:id', auth, admin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Clean up user data
    await Promise.all([
      Chat.deleteMany({ userId: req.params.id }),
      Note.deleteMany({ userId: req.params.id }),
      Task.deleteMany({ userId: req.params.id }),
      Reminder.deleteMany({ userId: req.params.id }),
      File.deleteMany({ userId: req.params.id }),
      Memory.deleteMany({ userId: req.params.id })
    ]);
    
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ===== WEBSOCKET =====

wss.on('connection', (ws, req) => {
  console.log('🟢 WebSocket client connected');
  let userId = null;
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'authenticate':
          try {
            const decoded = jwt.verify(data.token, process.env.JWT_SECRET);
            userId = decoded.id;
            ws.send(JSON.stringify({ type: 'authenticated', success: true }));
            console.log(`🔐 User ${userId} authenticated via WebSocket`);
          } catch (error) {
            ws.send(JSON.stringify({ type: 'authenticated', success: false, error: 'Invalid token' }));
          }
          break;
          
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
          
        case 'chat':
          // Handle real-time chat
          ws.send(JSON.stringify({ type: 'message', content: 'Processing...' }));
          break;
          
        case 'typing':
          // Broadcast typing status
          ws.send(JSON.stringify({ type: 'typing', isTyping: data.isTyping }));
          break;
          
        default:
          ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', error: error.message }));
    }
  });
  
  ws.on('close', () => {
    console.log(`🔴 WebSocket disconnected${userId ? ` (User: ${userId})` : ''}`);
  });
  
  // Send initial connection message
  ws.send(JSON.stringify({ type: 'connected', message: 'Connected to JARVIS WebSocket' }));
});

// ============ ERROR HANDLING ============

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ START SERVER ============

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 JARVIS Backend running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket running on ws://localhost:${PORT}`);
  console.log(`📊 API endpoints available at /api/*`);
  console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET ? '✅ Set' : '❌ Not set'}`);
  console.log(`📦 MongoDB: ${mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Disconnected'}`);
  console.log(`🤖 OpenAI: ${process.env.OPENAI_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
});

// ============ GRACEFUL SHUTDOWN ============

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await mongoose.disconnect();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
