// frontend/app.js - Complete JARVIS Application
(function() {
  'use strict';

  // ============ STATE ============
  const state = {
    user: null,
    token: localStorage.getItem('jarvis_token'),
    currentPage: 'chat',
    theme: 'dark',
    messages: [],
    isLoading: false,
    isRecording: false,
    voiceEnabled: true,
    chats: [],
    notes: [],
    tasks: [],
    reminders: [],
    memories: [],
    files: [],
    weather: null,
    date: new Date(),
    input: '',
    adminUsers: [],
    adminStats: {},
    toolResult: '',
    toolLoading: false,
    toolActive: 'chat'
  };

  // ============ API ============
  const API = {
    base: 'http://localhost:5000/api',
    
    async request(endpoint, options = {}) {
      const headers = {
        'Content-Type': 'application/json',
        ...options.headers
      };
      
      if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
      }
      
      const response = await fetch(`${this.base}${endpoint}`, {
        ...options,
        headers
      });
      
      if (response.status === 401) {
        localStorage.removeItem('jarvis_token');
        state.token = null;
        render();
        throw new Error('Unauthorized');
      }
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Request failed');
      return data;
    },
    
    async get(endpoint) {
      return this.request(endpoint, { method: 'GET' });
    },
    
    async post(endpoint, body) {
      return this.request(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
      });
    },
    
    async put(endpoint, body) {
      return this.request(endpoint, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
    },
    
    async delete(endpoint) {
      return this.request(endpoint, { method: 'DELETE' });
    },
    
    async upload(endpoint, file) {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch(`${this.base}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.token}`
        },
        body: formData
      });
      
      return response.json();
    }
  };

  // ============ RENDER ENGINE ============
  function render() {
    const root = document.getElementById('root');
    
    if (!state.token) {
      root.innerHTML = renderAuth();
      bindAuthEvents();
      return;
    }
    
    root.innerHTML = renderApp();
    bindAppEvents();
    
    // Load data
    if (state.currentPage === 'chat') loadChats();
    if (state.currentPage === 'dashboard') loadDashboard();
    if (state.currentPage === 'notes') loadNotes();
    if (state.currentPage === 'tasks') loadTasks();
    if (state.currentPage === 'admin') loadAdmin();
  }

  // ============ AUTH PAGE ============
  function renderAuth() {
    return `
      <div class="min-h-screen flex items-center justify-center p-4" style="
        background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%);
      ">
        <div class="glass rounded-2xl p-8 w-full max-w-md">
          <div class="text-center mb-8">
            <div class="text-5xl mb-2">🤖</div>
            <h1 class="text-4xl font-bold gradient-text">J.A.R.V.I.S.</h1>
            <p class="text-gray-400 mt-2">Your AI Assistant</p>
          </div>
          
          <form id="auth-form" class="space-y-4">
            <div id="auth-fields">
              <input type="text" id="auth-username" placeholder="Username" class="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none transition" />
            </div>
            <input type="email" id="auth-email" placeholder="Email" class="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none transition" required />
            <input type="password" id="auth-password" placeholder="Password" class="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none transition" required />
            
            <button type="submit" id="auth-submit" class="w-full py-3 rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold hover:opacity-90 transition">
              Sign In
            </button>
          </form>
          
          <p class="text-center mt-4 text-gray-400">
            <span id="auth-toggle-text">Don't have an account?</span>
            <button id="auth-toggle" class="text-blue-400 hover:underline ml-2">Sign Up</button>
          </p>
        </div>
      </div>
    `;
  }

  function bindAuthEvents() {
    let isLogin = true;
    
    document.getElementById('auth-toggle').addEventListener('click', () => {
      isLogin = !isLogin;
      document.getElementById('auth-fields').style.display = isLogin ? 'none' : 'block';
      document.getElementById('auth-submit').textContent = isLogin ? 'Sign In' : 'Create Account';
      document.getElementById('auth-toggle-text').textContent = isLogin ? "Don't have an account?" : 'Already have an account?';
    });
    
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value;
      const password = document.getElementById('auth-password').value;
      const username = document.getElementById('auth-username').value;
      
      try {
        const endpoint = isLogin ? '/auth/login' : '/auth/register';
        const body = isLogin ? { email, password } : { username, email, password };
        const data = await API.post(endpoint, body);
        state.token = data.token;
        state.user = data.user;
        localStorage.setItem('jarvis_token', data.token);
        render();
      } catch (error) {
        showToast(error.message || 'Authentication failed', 'error');
      }
    });
  }

  // ============ MAIN APP ============
  function renderApp() {
    return `
      <div class="flex h-screen">
        ${renderSidebar()}
        <div class="flex-1 overflow-hidden">
          ${state.currentPage === 'dashboard' ? renderDashboard() : ''}
          ${state.currentPage === 'chat' ? renderChat() : ''}
          ${state.currentPage === 'tools' ? renderTools() : ''}
          ${state.currentPage === 'notes' ? renderNotes() : ''}
          ${state.currentPage === 'tasks' ? renderTasks() : ''}
          ${state.currentPage === 'settings' ? renderSettings() : ''}
          ${state.currentPage === 'admin' ? renderAdmin() : ''}
        </div>
      </div>
      ${renderToast()}
    `;
  }

  // ============ SIDEBAR ============
  function renderSidebar() {
    const pages = [
      { id: 'dashboard', icon: 'fa-gauge-high', label: 'Dashboard' },
      { id: 'chat', icon: 'fa-comment-dots', label: 'Chat' },
      { id: 'tools', icon: 'fa-wand-magic-sparkles', label: 'Tools' },
      { id: 'notes', icon: 'fa-note-sticky', label: 'Notes' },
      { id: 'tasks', icon: 'fa-list-check', label: 'Tasks' },
      { id: 'settings', icon: 'fa-gear', label: 'Settings' }
    ];
    
    if (state.user?.isAdmin) {
      pages.push({ id: 'admin', icon: 'fa-users-gear', label: 'Admin' });
    }
    
    return `
      <div class="sidebar glass-dark w-20 md:w-64 flex flex-col border-r border-white/5">
        <div class="p-4 text-center border-b border-white/5">
          <div class="text-2xl md:text-3xl font-bold gradient-text">JARVIS</div>
          <div class="text-xs text-gray-500 hidden md:block">v2.0</div>
        </div>
        
        <nav class="flex-1 p-2 space-y-1">
          ${pages.map(p => `
            <div class="sidebar-item ${state.currentPage === p.id ? 'active' : ''}" data-page="${p.id}">
              <i class="fa-solid ${p.icon} w-5 text-center"></i>
              <span class="sidebar-label hidden md:inline">${p.label}</span>
            </div>
          `).join('')}
        </nav>
        
        <div class="p-4 border-t border-white/5">
          <div class="flex items-center gap-3 px-2 py-2">
            <div class="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              ${state.user?.username?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div class="hidden md:block">
              <div class="text-sm font-medium text-white">${state.user?.username || 'User'}</div>
              <div class="text-xs text-gray-500">${state.user?.email || ''}</div>
            </div>
          </div>
          <button id="logout-btn" class="w-full mt-2 flex items-center gap-3 px-2 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition">
            <i class="fa-solid fa-right-from-bracket w-5 text-center"></i>
            <span class="hidden md:inline">Logout</span>
          </button>
        </div>
      </div>
    `;
  }

  // ============ DASHBOARD ============
  function renderDashboard() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';
    
    return `
      <div class="h-full overflow-y-auto p-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Greeting -->
          <div class="md:col-span-2 rounded-2xl p-8" style="
            background: linear-gradient(135deg, #1a1a2e, #3b82f6);
          ">
            <h1 class="text-3xl font-bold text-white">${greeting}, ${state.user?.username || 'User'}! 👋</h1>
            <p class="text-blue-200 mt-2">How can JARVIS assist you today?</p>
          </div>
          
          <!-- Clock & Weather -->
          <div class="glass rounded-2xl p-6">
            <div id="clock" class="text-3xl font-bold text-white">${state.date.toLocaleTimeString()}</div>
            <div class="text-gray-400">${state.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
            ${state.weather ? `
              <div class="mt-4 flex items-center gap-3">
                <img src="https://openweathermap.org/img/wn/${state.weather.icon}@2x.png" alt="weather" class="w-12 h-12" />
                <div>
                  <div class="text-xl font-semibold text-white">${state.weather.temp}°C</div>
                  <div class="text-gray-400 text-sm">${state.weather.description}</div>
                </div>
              </div>
            ` : '<div class="text-gray-500 mt-4">Loading weather...</div>'}
          </div>
        </div>
        
        <!-- Stats -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          ${[
            { icon: 'fa-comment-dots', label: 'Chats', value: state.chats.length },
            { icon: 'fa-list-check', label: 'Tasks', value: state.tasks.filter(t => !t.completed).length },
            { icon: 'fa-note-sticky', label: 'Notes', value: state.notes.length },
            { icon: 'fa-bell', label: 'Reminders', value: state.reminders.length }
          ].map(stat => `
            <div class="glass rounded-xl p-4">
              <i class="fa-solid ${stat.icon} text-blue-400 text-xl"></i>
              <div class="text-2xl font-bold text-white mt-2">${stat.value}</div>
              <div class="text-gray-400 text-sm">${stat.label}</div>
            </div>
          `).join('')}
        </div>
        
        <!-- Recent Chats -->
        <div class="mt-6">
          <h3 class="text-lg font-semibold text-white mb-3">Recent Chats</h3>
          <div class="space-y-2">
            ${state.chats.slice(0, 5).map(chat => `
              <div class="glass rounded-lg p-3 flex justify-between items-center">
                <span class="text-white">${chat.title || 'New Chat'}</span>
                <span class="text-gray-500 text-sm">${new Date(chat.updatedAt).toLocaleDateString()}</span>
              </div>
            `).join('')}
            ${state.chats.length === 0 ? '<div class="text-gray-500">No chats yet</div>' : ''}
          </div>
        </div>
      </div>
    `;
  }

  // ============ CHAT PAGE ============
  function renderChat() {
    return `
      <div class="h-full flex flex-col">
        <div class="flex-1 overflow-y-auto p-4 space-y-4" id="chat-messages">
          ${state.messages.length === 0 ? `
            <div class="h-full flex items-center justify-center">
              <div class="text-center text-gray-500">
                <div class="text-6xl mb-4 float">🤖</div>
                <h2 class="text-2xl font-bold text-white">Welcome to JARVIS</h2>
                <p>How can I help you today?</p>
              </div>
            </div>
          ` : state.messages.map((msg, i) => `
            <div class="flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}">
              <div class="max-w-[85%] ${msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'} p-4 ${msg.role === 'user' ? '' : 'text-white'}">
                ${msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
              </div>
            </div>
          `).join('')}
          ${state.isLoading ? `
            <div class="flex justify-start">
              <div class="chat-bubble-ai p-4">
                <div class="flex gap-2">
                  <span class="typing-dot w-2 h-2 bg-blue-400 rounded-full"></span>
                  <span class="typing-dot w-2 h-2 bg-blue-400 rounded-full"></span>
                  <span class="typing-dot w-2 h-2 bg-blue-400 rounded-full"></span>
                </div>
              </div>
            </div>
          ` : ''}
          <div id="chat-end"></div>
        </div>
        
        <div class="p-4 border-t border-white/5">
          <div class="flex gap-2">
            <button id="voice-toggle" class="p-3 rounded-lg ${state.voiceEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'} transition hover:bg-opacity-30">
              <i class="fa-solid ${state.voiceEnabled ? 'fa-microphone' : 'fa-microphone-slash'}"></i>
            </button>
            <button id="stop-btn" class="p-3 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition">
              <i class="fa-solid fa-stop"></i>
            </button>
            <input id="chat-input" type="text" placeholder="Type your message..." class="flex-1 px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none transition" />
            <button id="voice-rec-btn" class="p-3 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition ${state.isRecording ? 'animate-pulse' : ''}">
              <i class="fa-solid fa-waveform"></i>
            </button>
            <button id="send-btn" class="p-3 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition">
              <i class="fa-solid fa-paper-plane"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ============ TOOLS PAGE ============
  function renderTools() {
    const tools = [
      { id: 'chat', icon: 'fa-comment', label: 'Chat' },
      { id: 'code', icon: 'fa-code', label: 'Code Generator' },
      { id: 'image', icon: 'fa-image', label: 'Image Generator' },
      { id: 'summarize', icon: 'fa-file-lines', label: 'Summarizer' },
      { id: 'translate', icon: 'fa-language', label: 'Translator' },
      { id: 'grammar', icon: 'fa-spell-check', label: 'Grammar Fixer' },
      { id: 'email', icon: 'fa-envelope', label: 'Email Writer' }
    ];
    
    return `
      <div class="h-full flex">
        <div class="w-48 border-r border-white/5 p-4 space-y-1">
          ${tools.map(t => `
            <div class="sidebar-item ${state.toolActive === t.id ? 'active' : ''}" data-tool="${t.id}">
              <i class="fa-solid ${t.icon} w-5 text-center"></i>
              <span class="text-sm">${t.label}</span>
            </div>
          `).join('')}
        </div>
        
        <div class="flex-1 p-6 overflow-y-auto">
          <h3 class="text-xl font-semibold text-white mb-4">${tools.find(t => t.id === state.toolActive)?.label || 'Tool'}</h3>
          
          <textarea id="tool-input" class="w-full h-32 px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none transition" placeholder="Enter your prompt..."></textarea>
          
          <button id="tool-generate" class="mt-4 px-6 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition">
            ${state.toolLoading ? 'Processing...' : 'Generate'}
          </button>
          
          ${state.toolResult ? `
            <div class="mt-6 p-4 rounded-lg bg-white/5 border border-white/10">
              <div class="text-white markdown">${renderMarkdown(state.toolResult)}</div>
              <button class="mt-3 px-4 py-1 rounded bg-gray-700 text-white text-sm hover:bg-gray-600 transition copy-btn">
                <i class="fa-regular fa-copy mr-1"></i> Copy
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // ============ NOTES PAGE ============
  function renderNotes() {
    return `
      <div class="h-full overflow-y-auto p-6">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold text-white">📝 Notes</h2>
          <button id="add-note" class="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition">
            <i class="fa-solid fa-plus mr-2"></i>New Note
          </button>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${state.notes.map(note => `
            <div class="glass rounded-lg p-4">
              <div class="flex justify-between items-start">
                <h4 class="text-white font-semibold">${note.title}</h4>
                <div class="flex gap-2">
                  <button class="text-gray-400 hover:text-blue-400 transition delete-note" data-id="${note._id}">
                    <i class="fa-regular fa-trash-can"></i>
                  </button>
                </div>
              </div>
              <p class="text-gray-400 text-sm mt-2 line-clamp-3">${note.content || ''}</p>
              <div class="text-gray-500 text-xs mt-3">${new Date(note.createdAt).toLocaleDateString()}</div>
            </div>
          `).join('')}
          ${state.notes.length === 0 ? '<div class="text-gray-500 col-span-3 text-center py-12">No notes yet. Create your first note!</div>' : ''}
        </div>
      </div>
    `;
  }

  // ============ TASKS PAGE ============
  function renderTasks() {
    return `
      <div class="h-full overflow-y-auto p-6">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold text-white">✅ Tasks</h2>
          <button id="add-task" class="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition">
            <i class="fa-solid fa-plus mr-2"></i>New Task
          </button>
        </div>
        
        <div class="space-y-2">
          ${state.tasks.map(task => `
            <div class="glass rounded-lg p-4 flex items-center gap-4 ${task.completed ? 'opacity-50' : ''}">
              <button class="toggle-task text-2xl" data-id="${task._id}">
                <i class="fa-${task.completed ? 'solid' : 'regular'} fa-circle-check ${task.completed ? 'text-green-400' : 'text-gray-500'}"></i>
              </button>
              <div class="flex-1">
                <div class="text-white ${task.completed ? 'line-through' : ''}">${task.title}</div>
                ${task.description ? `<div class="text-gray-400 text-sm">${task.description}</div>` : ''}
                ${task.dueDate ? `<div class="text-gray-500 text-xs">Due: ${new Date(task.dueDate).toLocaleDateString()}</div>` : ''}
              </div>
              <button class="text-gray-400 hover:text-red-400 transition delete-task" data-id="${task._id}">
                <i class="fa-regular fa-trash-can"></i>
              </button>
            </div>
          `).join('')}
          ${state.tasks.length === 0 ? '<div class="text-gray-500 text-center py-12">No tasks yet. Stay productive!</div>' : ''}
        </div>
      </div>
    `;
  }

  // ============ SETTINGS PAGE ============
  function renderSettings() {
    return `
      <div class="h-full overflow-y-auto p-6">
        <h2 class="text-2xl font-bold text-white mb-6">⚙️ Settings</h2>
        
        <div class="max-w-2xl space-y-6">
          <!-- Theme -->
          <div class="glass rounded-lg p-4">
            <h3 class="text-white font-semibold mb-2">Theme</h3>
            <div class="flex gap-2">
              <button class="theme-btn px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30" data-theme="dark">
                <i class="fa-solid fa-moon mr-2"></i>Dark
              </button>
              <button class="theme-btn px-4 py-2 rounded-lg bg-gray-700 text-gray-400 border border-transparent" data-theme="light">
                <i class="fa-solid fa-sun mr-2"></i>Light
              </button>
            </div>
          </div>
          
          <!-- Voice -->
          <div class="glass rounded-lg p-4">
            <h3 class="text-white font-semibold mb-2">Voice Settings</h3>
            <select id="voice-select" class="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:border-blue-500 focus:outline-none">
              <option value="alloy">Alloy</option>
              <option value="echo">Echo</option>
              <option value="fable">Fable</option>
              <option value="onyx">Onyx</option>
              <option value="nova">Nova</option>
              <option value="shimmer">Shimmer</option>
            </select>
            <div class="mt-2 flex items-center gap-2">
              <input type="text" id="wake-word" value="${state.user?.preferences?.wakeWord || 'Jarvis'}" class="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:border-blue-500 focus:outline-none" />
              <span class="text-gray-400 text-sm">Wake Word</span>
            </div>
          </div>
          
          <button id="save-settings" class="px-6 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition">
            Save Settings
          </button>
        </div>
      </div>
    `;
  }

  // ============ ADMIN PAGE ============
  function renderAdmin() {
    return `
      <div class="h-full overflow-y-auto p-6">
        <h2 class="text-2xl font-bold text-white mb-6">🛡️ Admin Dashboard</h2>
        
        <div class="grid grid-cols-4 gap-4 mb-6">
          ${[
            { label: 'Users', value: state.adminStats.totalUsers || 0, icon: 'fa-users' },
            { label: 'Chats', value: state.adminStats.totalChats || 0, icon: 'fa-comments' },
            { label: 'Notes', value: state.adminStats.totalNotes || 0, icon: 'fa-note-sticky' },
            { label: 'Tasks', value: state.adminStats.totalTasks || 0, icon: 'fa-list-check' }
          ].map(stat => `
            <div class="glass rounded-lg p-4 text-center">
              <i class="fa-solid ${stat.icon} text-blue-400 text-2xl"></i>
              <div class="text-2xl font-bold text-white">${stat.value}</div>
              <div class="text-gray-400 text-sm">${stat.label}</div>
            </div>
          `).join('')}
        </div>
        
        <div class="glass rounded-lg overflow-hidden">
          <table class="w-full">
            <thead class="bg-white/5">
              <tr>
                <th class="px-4 py-3 text-left text-gray-400 text-sm">User</th>
                <th class="px-4 py-3 text-left text-gray-400 text-sm">Email</th>
                <th class="px-4 py-3 text-left text-gray-400 text-sm">Subscription</th>
                <th class="px-4 py-3 text-left text-gray-400 text-sm">Chats</th>
                <th class="px-4 py-3 text-left text-gray-400 text-sm">Joined</th>
              </tr>
            </thead>
            <tbody>
              ${state.adminUsers.map(user => `
                <tr class="border-t border-white/5">
                  <td class="px-4 py-3 text-white">${user.username}</td>
                  <td class="px-4 py-3 text-gray-400">${user.email}</td>
                  <td class="px-4 py-3"><span class="px-2 py-1 rounded text-xs ${user.subscription === 'premium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700 text-gray-400'}">${user.subscription}</span></td>
                  <td class="px-4 py-3 text-gray-400">${user.usage?.chats || 0}</td>
                  <td class="px-4 py-3 text-gray-400">${new Date(user.createdAt).toLocaleDateString()}</td>
                </tr>
              `).join('')}
              ${state.adminUsers.length === 0 ? '<tr><td colspan="5" class="text-center text-gray-500 py-8">No users found</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ============ TOAST ============
  function renderToast() {
    return `<div id="toast-container" class="fixed top-4 right-4 z-50 space-y-2"></div>`;
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const colors = {
      success: 'border-green-500 text-green-400',
      error: 'border-red-500 text-red-400',
      info: 'border-blue-500 text-blue-400'
    };
    
    const toast = document.createElement('div');
    toast.className = `glass px-6 py-3 rounded-lg border-l-4 ${colors[type] || colors.info} transition-all`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ============ MARKDOWN RENDERER ============
  function renderMarkdown(text) {
    if (!text) return '';
    
    // Simple markdown renderer
    let html = text;
    
    // Code blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="language-${lang || 'text'}">${escapeHtml(code.trim())}</code></pre>`;
    });
    
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Headers
    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Lists
    html = html.replace(/^[\s]*[-*] (.*$)/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="text-blue-400 hover:underline">$1</a>');
    
    // Blockquotes
    html = html.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>');
    
    // Line breaks
    html = html.replace(/\n/g, '<br />');
    
    return html;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============ EVENT BINDINGS ============
  function bindAppEvents() {
    // Sidebar navigation
    document.querySelectorAll('.sidebar-item[data-page]').forEach(el => {
      el.addEventListener('click', () => {
        state.currentPage = el.dataset.page;
        render();
      });
    });
    
    // Tool navigation
    document.querySelectorAll('[data-tool]').forEach(el => {
      el.addEventListener('click', () => {
        state.toolActive = el.dataset.tool;
        state.toolResult = '';
        render();
      });
    });
    
    // Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('jarvis_token');
        state.token = null;
        render();
      });
    }
    
    // Chat
    const sendBtn = document.getElementById('send-btn');
    const chatInput = document.getElementById('chat-input');
    const stopBtn = document.getElementById('stop-btn');
    
    if (sendBtn && chatInput) {
      const sendMessage = () => {
        const text = chatInput.value.trim();
        if (text && !state.isLoading) {
          chatInput.value = '';
          sendChatMessage(text);
        }
      };
      
      sendBtn.addEventListener('click', sendMessage);
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
      });
    }
    
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        state.isLoading = false;
        render();
      });
    }
    
    // Voice toggle
    const voiceToggle = document.getElementById('voice-toggle');
    if (voiceToggle) {
      voiceToggle.addEventListener('click', () => {
        state.voiceEnabled = !state.voiceEnabled;
        render();
      });
    }
    
    // Voice recognition
    const voiceRecBtn = document.getElementById('voice-rec-btn');
    if (voiceRecBtn) {
      voiceRecBtn.addEventListener('click', startVoiceRecognition);
    }
    
    // Tools
    const toolGenerate = document.getElementById('tool-generate');
    if (toolGenerate) {
      toolGenerate.addEventListener('click', async () => {
        const input = document.getElementById('tool-input');
        if (!input) return;
        
        state.toolLoading = true;
        state.toolResult = '';
        render();
        
        try {
          const endpoints = {
            'code': '/tools/generate-code',
            'image': '/tools/generate-image',
            'summarize': '/tools/summarize',
            'translate': '/tools/translate',
            'grammar': '/tools/fix-grammar',
            'email': '/tools/email-writer'
          };
          
          const endpoint = endpoints[state.toolActive];
          if (!endpoint) {
            state.toolResult = 'This tool is not available yet.';
            state.toolLoading = false;
            render();
            return;
          }
          
          const data = await API.post(endpoint, { 
            prompt: input.value,
            targetLang: 'Spanish',
            language: 'javascript',
            text: input.value
          });
          
          state.toolResult = data.code || data.url || data.summary || data.translated || data.fixed || data.email || 'Done!';
        } catch (error) {
          state.toolResult = `Error: ${error.message}`;
        }
        
        state.toolLoading = false;
        render();
      });
    }
    
    // Copy button
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.closest('.p-4')?.querySelector('.markdown')?.textContent || '';
        navigator.clipboard?.writeText(text);
        showToast('Copied to clipboard!', 'success');
      });
    });
    
    // Notes
    const addNote = document.getElementById('add-note');
    if (addNote) {
      addNote.addEventListener('click', async () => {
        const title = prompt('Note title:');
        if (title) {
          const content = prompt('Note content:');
          try {
            await API.post('/notes', { title, content });
            await loadNotes();
            render();
            showToast('Note created!', 'success');
          } catch (error) {
            showToast('Failed to create note', 'error');
          }
        }
      });
    }
    
    document.querySelectorAll('.delete-note').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Delete this note?')) {
          await API.delete(`/notes/${btn.dataset.id}`);
          await loadNotes();
          render();
        }
      });
    });
    
    // Tasks
    const addTask = document.getElementById('add-task');
    if (addTask) {
      addTask.addEventListener('click', async () => {
        const title = prompt('Task title:');
        if (title) {
          try {
            await API.post('/tasks', { title, completed: false });
            await loadTasks();
            render();
            showToast('Task added!', 'success');
          } catch (error) {
            showToast('Failed to add task', 'error');
          }
        }
      });
    }
    
    document.querySelectorAll('.toggle-task').forEach(btn => {
      btn.addEventListener('click', async () => {
        const task = state.tasks.find(t => t._id === btn.dataset.id);
        if (task) {
          await API.put(`/tasks/${task._id}`, { ...task, completed: !task.completed });
          await loadTasks();
          render();
        }
      });
    });
    
    document.querySelectorAll('.delete-task').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Delete this task?')) {
          await API.delete(`/tasks/${btn.dataset.id}`);
          await loadTasks();
          render();
        }
      });
    });
    
    // Settings
    const saveSettings = document.getElementById('save-settings');
    if (saveSettings) {
      saveSettings.addEventListener('click', async () => {
        const voice = document.getElementById('voice-select')?.value || 'alloy';
        const wakeWord = document.getElementById('wake-word')?.value || 'Jarvis';
        try {
          await API.put('/user/profile', {
            preferences: { ...state.user?.preferences, voice, wakeWord }
          });
          showToast('Settings saved!', 'success');
        } catch (error) {
          showToast('Failed to save settings', 'error');
        }
      });
    }
    
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.theme-btn').forEach(b => {
          b.className = 'theme-btn px-4 py-2 rounded-lg bg-gray-700 text-gray-400 border border-transparent';
        });
        btn.className = 'theme-btn px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30';
        state.theme = btn.dataset.theme;
        // Apply theme logic here
      });
    });
    
    // Auto-save chat input
    const chatInputField = document.getElementById('chat-input');
    if (chatInputField) {
      chatInputField.addEventListener('input', (e) => {
        state.input = e.target.value;
      });
    }
  }

  // ============ CHAT FUNCTIONS ============
  async function sendChatMessage(text) {
    const userMessage = { role: 'user', content: text };
    state.messages.push(userMessage);
    state.isLoading = true;
    render();
    
    try {
      const data = await API.post('/chat', {
        messages: state.messages,
        model: 'gpt-3.5-turbo'
      });
      
      state.messages.push({ role: 'assistant', content: data.content });
      
      // Text-to-speech
      if (state.voiceEnabled) {
        speakText(data.content);
      }
      
      await loadChats();
    } catch (error) {
      state.messages.push({ role: 'assistant', content: `Error: ${error.message}` });
    }
    
    state.isLoading = false;
    render();
    
    // Scroll to bottom
    const end = document.getElementById('chat-end');
    if (end) end.scrollIntoView({ behavior: 'smooth' });
  }

  function speakText(text) {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1.1;
      utterance.voice = speechSynthesis.getVoices().find(v => v.name.includes('Google UK')) || null;
      window.speechSynthesis.speak(utterance);
    }
  }

  function startVoiceRecognition() {
    if (!('webkitSpeechRecognition' in window)) {
      showToast('Voice recognition not supported in this browser', 'error');
      return;
    }
    
    state.isRecording = true;
    render();
    
    const recognition = new webkitSpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    
    recognition.onresult = (event) => {
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        }
      }
      if (final) {
        const input = document.getElementById('chat-input');
        if (input) {
          input.value = final;
          sendChatMessage(final);
        }
      }
    };
    
    recognition.onend = () => {
      state.isRecording = false;
      render();
    };
    
    recognition.onerror = () => {
      state.isRecording = false;
      render();
      showToast('Voice recognition error', 'error');
    };
    
    recognition.start();
  }

  // ============ DATA LOADERS ============
  async function loadChats() {
    try {
      state.chats = await API.get('/chat/history');
    } catch (error) {
      // Silently fail
    }
  }

  async function loadNotes() {
    try {
      state.notes = await API.get('/notes');
    } catch (error) {
      state.notes = [];
    }
  }

  async function loadTasks() {
    try {
      state.tasks = await API.get('/tasks');
    } catch (error) {
      state.tasks = [];
    }
  }

  async function loadDashboard() {
    try {
      // Load weather
      const weather = await API.get('/weather?city=London');
      state.weather = weather;
      
      // Load chats, notes, tasks in background
      await Promise.all([loadChats(), loadNotes(), loadTasks()]);
      render();
    } catch (error) {
      // Silently fail
    }
  }

  async function loadAdmin() {
    try {
      const [users, stats] = await Promise.all([
        API.get('/admin/users'),
        API.get('/admin/stats')
      ]);
      state.adminUsers = users;
      state.adminStats = stats;
      render();
    } catch (error) {
      showToast('Failed to load admin data', 'error');
    }
  }

  // ============ CLOCK UPDATER ============
  function updateClock() {
    state.date = new Date();
    const clock = document.getElementById('clock');
    if (clock) {
      clock.textContent = state.date.toLocaleTimeString();
    }
  }

  // ============ INIT ============
  // Check for existing session
  if (state.token) {
    API.get('/user/profile')
      .then(user => {
        state.user = user;
        render();
        // Start clock
        setInterval(updateClock, 1000);
        // Load initial data
        loadChats();
        loadDashboard();
      })
      .catch(() => {
        state.token = null;
        localStorage.removeItem('jarvis_token');
        render();
      });
  } else {
    render();
  }

  // Make API available globally for debugging
  window.__JARVIS = { API, state, render };

})();
