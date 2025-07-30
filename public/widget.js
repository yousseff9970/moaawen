(function () {
  const currentScript = document.currentScript || 
                        document.querySelector('script[src*="widget.js"]');
  const apiKey = currentScript?.dataset.apiKey || null;

  if (!apiKey) {
    console.error('❌ Moaawen Widget: Missing API key. Please add data-api-key attribute.');
    return;
  }

  const apiEndpoint = 'https://moaawen.onrender.com/api/chat';
  const storageKey = 'moaawen_chat_history';
  let userMarket = null;

  // Create widget root
  let root = document.getElementById('moaawen-widget-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'moaawen-widget-root';
    document.body.appendChild(root);
  }

  // Detect user country
  fetch('https://ipapi.co/json/')
    .then(res => res.json())
    .then(data => {
      userMarket = data.country_code || 'LB';
    })
    .catch(() => userMarket = 'US');

  // Shadow DOM
  const shadow = root.attachShadow({ mode: 'open' });

  // Ultra-modern styles with glassmorphism and advanced animations
  const style = document.createElement('style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    
    
    :host {
      --primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      --secondary-gradient: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      --success-gradient: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
      --glass-bg: rgba(255, 255, 255, 0.08);
      --glass-border: rgba(255, 255, 255, 0.18);
      --glass-blur: blur(20px);
      --shadow-soft: 0 8px 32px rgba(0, 0, 0, 0.12);
      --shadow-medium: 0 16px 48px rgba(0, 0, 0, 0.16);
      --shadow-hard: 0 24px 64px rgba(0, 0, 0, 0.24);
      --text-primary: #1a1a1a;
      --text-secondary: #6b7280;
      --border-subtle: rgba(0, 0, 0, 0.06);
      --bg-surface: #ffffff;
      --bg-elevated: #f8fafc;
    }

    .chat-widget {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      color: var(--text-primary);
    }

    .chat-bubble {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: var(--primary-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      cursor: pointer;
      box-shadow: var(--shadow-medium);
      transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      position: relative;
      overflow: hidden;
    }

    .chat-bubble::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--success-gradient);
      opacity: 0;
      transition: opacity 0.3s ease;
      border-radius: 50%;
    }

    .chat-bubble:hover {
      transform: scale(1.1) rotate(5deg);
      box-shadow: var(--shadow-hard);
    }

    .chat-bubble:hover::before {
      opacity: 1;
    }

    .chat-bubble i {
      font-size: 24px;
      position: relative;
      z-index: 2;
      animation: bounce 2s infinite;
    }

    .notification-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 20px;
      height: 20px;
      background: var(--secondary-gradient);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
      color: white;
      animation: pulse-badge 2s infinite;
      border: 2px solid white;
    }

    @keyframes bounce {
      0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-4px); }
      60% { transform: translateY(-2px); }
    }

    @keyframes pulse-badge {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.2); }
    }

    .chat-window {
      width: 420px;
      height: 580px;
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: 24px;
      display: none;
      flex-direction: column;
      overflow: hidden;
      box-shadow: var(--shadow-hard);
      animation: slideInUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      position: relative;
    }

    .chat-window::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--bg-surface);
      opacity: 0.95;
      z-index: -1;
      border-radius: 24px;
    }

    @media (max-width: 576px) {
      .chat-window {
        width: 100vw;
        height: 100vh;
        border-radius: 0;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
      }
      .chat-widget {
        bottom: 20px;
        right: 20px;
      }
      .chat-bubble {
        width: 56px;
        height: 56px;
      }
      .chat-bubble i {
        font-size: 20px;
      }
    }

    @keyframes slideInUp {
      from {
        opacity: 0;
        transform: translateY(30px) scale(0.9);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .chat-header {
      background: var(--primary-gradient);
      color: white;
      padding: 20px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      font-size: 16px;
      position: relative;
    }

    .chat-header::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
    }

    .header-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      animation: pulse-status 2s infinite;
    }

    @keyframes pulse-status {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .close-btn {
      background: rgba(255, 255, 255, 0.15);
      border: none;
      color: white;
      font-size: 18px;
      cursor: pointer;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      backdrop-filter: blur(10px);
    }

    .close-btn:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: rotate(90deg);
    }

    .chat-messages {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: var(--bg-elevated);
      scroll-behavior: smooth;
    }

    .chat-messages::-webkit-scrollbar {
      width: 4px;
    }

    .chat-messages::-webkit-scrollbar-track {
      background: transparent;
    }

    .chat-messages::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.1);
      border-radius: 2px;
    }

    .message {
      max-width: 85%;
      animation: messageSlideIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      position: relative;
    }

    @keyframes messageSlideIn {
      from {
        opacity: 0;
        transform: translateY(10px) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .message-bubble {
      padding: 16px 20px;
      border-radius: 20px;
      font-size: 14px;
      
      position: relative;
      box-shadow: var(--shadow-soft);
    }

    .message.user {
      align-self: flex-end;
    }

    .message.user .message-bubble {
      background: var(--primary-gradient);
      color: white;
      border-bottom-right-radius: 6px;
    }

    .message.bot {
      align-self: flex-start;
    }

    .message.bot .message-bubble {
      background: var(--bg-surface);
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
      border-bottom-left-radius: 6px;
    }

    .message-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      font-size: 11px;
      opacity: 0.7;
    }

    .message.user .message-meta {
      justify-content: flex-end;
      color: var(--text-secondary);
    }

    .message.bot .message-meta {
      justify-content: flex-start;
      color: var(--text-secondary);
    }

    .message-time {
      font-weight: 500;
    }

    .receipt {
      display: flex;
      align-items: center;
      gap: 4px;
      font-weight: 500;
    }

    .receipt.sent {
      color: #6b7280;
    }

    .receipt.delivered {
      color: #10b981;
    }

    .receipt.read {
      color: #3b82f6;
    }

    .typing-indicator {
      padding: 16px 24px;
      font-size: 13px;
      color: var(--text-secondary);
      display: none;
      align-items: center;
      gap: 8px;
      background: var(--bg-elevated);
      border-top: 1px solid var(--border-subtle);
    }

    .typing-dots {
      display: flex;
      gap: 4px;
    }

    .typing-dots span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-secondary);
      animation: typingDots 1.4s infinite ease-in-out;
    }

    .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
    .typing-dots span:nth-child(2) { animation-delay: -0.16s; }

    @keyframes typingDots {
      0%, 80%, 100% {
        transform: scale(0.8);
        opacity: 0.5;
      }
      40% {
        transform: scale(1);
        opacity: 1;
      }
    }

    .chat-footer {
      padding: 20px 24px;
      display: flex;
      gap: 12px;
      border-top: 1px solid var(--border-subtle);
      background: var(--bg-surface);
      border-bottom-left-radius: 24px;
      border-bottom-right-radius: 24px;
    }

    .input-container {
      flex: 1;
      position: relative;
    }

    .message-input {
      width: 85%;
      border-radius: 16px;
      padding: 12px 16px;
      border: 1px solid var(--border-subtle);
      font-size: 14px;
      font-weight: 400;
      resize: none;
      margin: 10 0 0 0 ;
      transition: all 0.2s ease;
      background: var(--bg-elevated);
      color: var(--text-primary);
      outline: none;
      font-family: inherit;
    }

    .message-input:focus {
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
      background: var(--bg-surface);
    }

    .message-input::placeholder {
      color: var(--text-secondary);
    }

    .send-button {
      background: var(--primary-gradient);
      color: white;
      border: none;
      border-radius: 16px;
      padding: 0 16px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 60px;
      justify-content: center;
      box-shadow: var(--shadow-soft);
    }

    .send-button:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: var(--shadow-medium);
    }

    .send-button:active {
      transform: translateY(0);
    }

    .send-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .send-button i {
      font-size: 16px;
    }

    .quick-actions {
      display: flex;
      gap: 8px;
      padding: 16px 24px 0;
      background: var(--bg-elevated);
    }

    .quick-action {
      padding: 8px 16px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .quick-action:hover {
      background: var(--primary-gradient);
      color: white;
      border-color: transparent;
      transform: translateY(-1px);
    }

    .welcome-message {
      text-align: center;
      padding: 32px 24px;
      color: var(--text-secondary);
      background: var(--bg-elevated);
    }

    .welcome-message h3 {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .welcome-message p {
      font-size: 14px;
      line-height: 1.5;
      margin-bottom: 20px;
    }

    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--success-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      font-size: 14px;
      margin-right: 12px;
      flex-shrink: 0;
    }

    .bot-message-container {
      display: flex;
      align-items: flex-start;
    }

    .user-message-container {
      display: flex;
      align-items: flex-end;
      flex-direction: row-reverse;
    }

    .user-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--secondary-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      font-size: 14px;
      margin-left: 12px;
      flex-shrink: 0;
    }

    .message-content {
      flex: 1;
    }

    .message a {
      color: #3b82f6;
      text-decoration: underline;
    }

    .message a:hover {
      color: #1d4ed8;
    }

    /* Enhanced loading states */
    .loading {
      opacity: 0.7;
      pointer-events: none;
    }

    .shimmer {
      background: linear-gradient(90deg, 
        var(--bg-elevated) 25%, 
        rgba(255,255,255,0.5) 50%, 
        var(--bg-elevated) 75%);
      background-size: 200% 100%;
      animation: shimmer 2s infinite;
    }

    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }

    .chat-bubble svg,
.close-btn svg,
.send-button svg {
  display: block;
}

.resize-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: white;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-right: -30%;
}

.resize-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}

.chat-window.large {
  width: 90vw !important;
  height: 90vh !important;
}
  .chat-window.large .resize-btn {
  
  margin-right: -80%;
}

@media (max-width: 768px) {
  .resize-btn {
    display: none;
  }
}


  `;
  shadow.appendChild(style);

  // Enhanced HTML with advanced UI components
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="chat-widget">
      <div class="chat-bubble" id="chatBubble">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="26" height="26">
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
</svg>

        <div class="notification-badge" id="notificationBadge" style="display: none;">1</div>
      </div>
      <div class="chat-window" id="chatWindow">
        <div class="chat-header">
          <div class="header-info">
            <div class="status-indicator"></div>
            <div>
              <div>Moaawen Assistant</div>
              <div style="font-size: 12px; opacity: 0.8; font-weight: 400;">Online</div>
            </div>
          </div>
          <button class="resize-btn" id="resizeBtn">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18">
    <path d="M15 3h6v6m-6-6 6 6M9 21H3v-6m6 6-6-6M21 15v6h-6m6-6-6 6M3 9V3h6M3 9l6-6"/>
  </svg>
</button>
          <button class="close-btn" id="closeBtn">
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="20" height="20">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>

          </button>
        </div>
        
        <div class="welcome-message" id="welcomeMessage">
          <h3>👋 Welcome to Moaawen</h3>
          <p>I'm here to help you with any questions you might have. How can I assist you today?</p>
          <div class="quick-actions">
            <div class="quick-action" data-message="Help me get started">Get Started</div>
            <div class="quick-action" data-message="What can you do?">Features</div>
            <div class="quick-action" data-message="Contact support">Support</div>
          </div>
        </div>
        
        <div class="chat-messages" id="chatMessages"></div>
        
        <div class="typing-indicator" id="typingIndicator">
          <div class="avatar">AI</div>
          <div>
            <em>Assistant is typing</em>
            <div class="typing-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
        
        <div class="chat-footer">
          <div class="input-container">
            <textarea 
              id="messageInput" 
              class="message-input"
              placeholder="Type your message..."
              rows="1"
            ></textarea>
          </div>
          <button class="send-button" id="sendBtn" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18">
  <line x1="22" y1="2" x2="11" y2="13"/>
  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
</svg>

          </button>
        </div>
      </div>
    </div>
  `;
  shadow.appendChild(container);

  // DOM refs
  const $ = (id) => shadow.getElementById(id);
  const chatBubble = $('chatBubble');
  const chatWindow = $('chatWindow');
  const chatMessages = $('chatMessages');
  const welcomeMessage = $('welcomeMessage');
  const typingIndicator = $('typingIndicator');
  const messageInput = $('messageInput');
  const sendBtn = $('sendBtn');
  const closeBtn = $('closeBtn');
  const notificationBadge = $('notificationBadge');

  // Load history
  let chatHistory = JSON.parse(localStorage.getItem(storageKey) || '[]');
  renderChatHistory();

  let isOpen = false;
  chatBubble.onclick = toggleChat;
  closeBtn.onclick = toggleChat;
  sendBtn.onclick = sendMessage;
  
  // Enhanced input handling
messageInput.oninput = () => {
  sendBtn.disabled = !messageInput.value.trim();
  autoResize();
};

  
  messageInput.onkeypress = (e) => { 
    if (e.key === 'Enter' && !e.shiftKey) { 
      e.preventDefault(); 
      sendMessage(); 
    } 
  };

  // Quick actions
 shadow.querySelectorAll('.quick-action').forEach(action => {
  action.onclick = () => {
    const message = action.dataset.message;
    messageInput.value = message || '';
    sendBtn.disabled = false;
    sendMessage();
  };
});


  function autoResize() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  }

  function toggleChat() {
    isOpen = !isOpen;
    chatBubble.style.display = isOpen ? 'none' : 'flex';
    chatWindow.style.display = isOpen ? 'flex' : 'none';
    notificationBadge.style.display = 'none';
    
    if (isOpen) {
      messageInput.focus();
      if (chatHistory.length === 0 && !localStorage.getItem('moaawen_welcome_shown')) {
        welcomeMessage.style.display = 'block';
        chatMessages.style.display = 'none';
        localStorage.setItem('moaawen_welcome_shown', 'true');
      } else {
        welcomeMessage.style.display = 'none';
        chatMessages.style.display = 'flex';
      }
    }
  }

function formatMessage(text) {
  return text
    // Bold **text**
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Bullet points or numbered lists: keep <br> before
    .replace(/\n\d+\.\s/g, '<br><br>$&')
    .replace(/\n-\s/g, '<br>• ')
    // New lines into <br><br> for better spacing
    .replace(/\n/g, '<br>')
    // Links
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
}


  function addMessage(text, isUser, receipt = null) {
    // Hide welcome message when first message is sent
    if (welcomeMessage.style.display !== 'none') {
      welcomeMessage.style.display = 'none';
      chatMessages.style.display = 'flex';
    }

    const message = { 
      text, 
      isUser, 
      receipt, 
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      id: Date.now() + Math.random()
    };
    
    chatHistory.push(message);
    localStorage.setItem(storageKey, JSON.stringify(chatHistory));
    renderMessage(message);

    // Show notification if chat is closed
    if (!isOpen && !isUser) {
      notificationBadge.style.display = 'flex';
    }
  }

  function renderChatHistory() {
    chatMessages.innerHTML = '';
    if (chatHistory.length === 0) {
      welcomeMessage.style.display = 'block';
      chatMessages.style.display = 'none';
    } else {
      welcomeMessage.style.display = 'none';
      chatMessages.style.display = 'flex';
      chatHistory.forEach(renderMessage);
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function renderMessage(msg) {
    const container = document.createElement('div');
    container.className = `message ${msg.isUser ? 'user' : 'bot'}`;
    
    if (msg.isUser) {
      container.innerHTML = `
        <div class="user-message-container">
          <div class="user-avatar">U</div>
          <div class="message-content">
            <div class="message-bubble">${formatMessage(msg.text)}</div>
            <div class="message-meta">
              <span class="message-time">${msg.timestamp}</span>
              <span class="receipt ${getReceiptClass(msg.receipt)}">${getReceiptIcon(msg.receipt)} ${msg.receipt || 'Sent'}</span>
            </div>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="bot-message-container">
          <div class="avatar">AI</div>
          <div class="message-content">
            <div class="message-bubble">${formatMessage(msg.text)}</div>
            <div class="message-meta">
              <span class="message-time">${msg.timestamp}</span>
            </div>
          </div>
        </div>
      `;
    }
    
    chatMessages.appendChild(container);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  const resizeBtn = $('resizeBtn');
resizeBtn.onclick = () => {
  chatWindow.classList.toggle('large');
};


  function getReceiptClass(receipt) {
    if (receipt?.includes('Read')) return 'read';
    if (receipt?.includes('✓✓')) return 'delivered';
    return 'sent';
  }

  function getReceiptIcon(receipt) {
    if (receipt?.includes('Read')) return '👁';
    if (receipt?.includes('✓✓')) return '✓✓';
    return '✓';
  }

  function generateSessionId() {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  }

  async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = '';
  sendBtn.disabled = true;
  autoResize();

  // Add user message
  addMessage(text, true, '✓ Sent');
  typingIndicator.style.display = 'flex';
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({
        message: text,
        sessionId: generateSessionId(),
        domain: window.location.hostname
      })
    });

    if (response.status === 429) {
      typingIndicator.style.display = 'none';
      addMessage('⚠️ You\'re sending too many messages. Please wait a minute before trying again.', false);
      return;
    }

    const data = await response.json();
    typingIndicator.style.display = 'none';

    // ✅ Update receipt directly without re-rendering all messages
    const lastUserMsg = chatMessages.querySelector('.message.user:last-child .receipt');
    if (lastUserMsg) {
      lastUserMsg.textContent = '✓✓ Read';
      lastUserMsg.classList.add('delivered');
    }

    // Update chatHistory in localStorage (but don't re-render)
    chatHistory = chatHistory.map((m, i) =>
      i === chatHistory.length - 1 && m.isUser
        ? { ...m, receipt: '✓✓ Read' }
        : m
    );
    localStorage.setItem(storageKey, JSON.stringify(chatHistory));

    // Simulate typing delay before AI reply
    setTimeout(() => {
      addMessage(data.reply || 'Sorry, I didn\'t receive a proper response. Please try again.', false);
    }, 800);

  } catch (err) {
    typingIndicator.style.display = 'none';
    addMessage('⚠️ Connection error. Please check your internet and try again.', false);
    console.error('Chat widget error:', err);
  }
}

})();