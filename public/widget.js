(function () {
  const apiEndpoint = 'https://moaawen.onrender.com/api/chat';
  const storageKey = 'moaawen_chat_history';

  // 1. Create widget root
  let root = document.getElementById('moaawen-widget-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'moaawen-widget-root';
    document.body.appendChild(root);
  }

  // 2. Attach Shadow DOM
  const shadow = root.attachShadow({ mode: 'open' });

  // 3. Styles (unchanged except new CSS for receipts)
  const style = document.createElement('style');
  style.textContent = `
    @import url('https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css');
    @import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css');

    /* Widget Styles */
    .chat-widget { position: fixed; bottom: 24px; right: 24px; z-index: 1050; font-family: 'Segoe UI', Roboto, sans-serif; }
    .chat-bubble { width: 60px; height: 60px; background: linear-gradient(135deg, #007bff 0%, #6f42c1 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 8px 32px rgba(0, 123, 255, 0.3); transition: all 0.3s ease; position: relative; animation: pulse 2s infinite; }
    .chat-bubble:hover { transform: scale(1.1); box-shadow: 0 12px 40px rgba(0, 123, 255, 0.4); }
    .chat-bubble i { color: white; font-size: 24px; }
    .notification-dot { position: absolute; top: -2px; right: -2px; width: 12px; height: 12px; background: #dc3545; border-radius: 50%; animation: bounce 1s infinite; }

    .chat-window { width: 350px; height: 500px; background: white; border-radius: 16px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15); display: none; flex-direction: column; overflow: hidden; }
    .chat-header { background: linear-gradient(135deg, #007bff 0%, #6f42c1 100%); color: white; padding: 16px; display: flex; justify-content: space-between; align-items: center; }
    .chat-messages { flex: 1; padding: 16px; overflow-y: auto; background: #f8f9fa; display: flex; flex-direction: column; gap: 16px; }

    .message { max-width: 85%; padding: 12px 16px; border-radius: 16px; font-size: 14px; line-height: 1.6; word-wrap: break-word; position: relative; }
    .message.user { align-self: flex-end; background: linear-gradient(135deg, #007bff 0%, #6f42c1 100%); color: white; border-bottom-right-radius: 4px; }
    .message.bot { align-self: flex-start; background: white; color: #333; border: 1px solid #e9ecef; border-bottom-left-radius: 4px; }

    .message .message-time { font-size: 11px; opacity: 0.7; margin-top: 4px; }
    .message .receipt { font-size: 11px; display: block; text-align: right; margin-top: 4px; opacity: 0.7; }

    @media (max-width: 576px) {
      .chat-window { width: calc(100vw - 20px); height: calc(100vh - 100px); }
    }
    @media (min-width: 992px) {
      .chat-window { width: 420px; height: 600px; }
      .chat-bubble { width: 70px; height: 70px; }
    }
  `;
  shadow.appendChild(style);

  // 4. Widget HTML
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="chat-widget">
      <div class="chat-bubble" id="chatBubble">
        <i class="fas fa-comment"></i>
        <div class="notification-dot"></div>
      </div>
      <div class="chat-window" id="chatWindow">
        <div class="chat-header">
          <div><strong>Chat Assistant</strong><div style="font-size:12px;">Online now</div></div>
          <button id="closeBtn" style="background:none;border:none;color:white;font-size:20px;cursor:pointer;">×</button>
        </div>
        <div class="chat-messages" id="chatMessages"></div>
        <div style="padding:12px;border-top:1px solid #ddd;display:flex;gap:8px;">
          <textarea id="messageInput" placeholder="Type your message..." style="flex:1;border-radius:8px;padding:8px;"></textarea>
          <button id="sendBtn" disabled style="background:#007bff;color:white;border:none;border-radius:8px;padding:0 16px;">Send</button>
        </div>
      </div>
    </div>
  `;
  shadow.appendChild(container);

  // 5. DOM refs
  const $ = (id) => shadow.getElementById(id);
  const chatBubble = $('chatBubble');
  const chatWindow = $('chatWindow');
  const chatMessages = $('chatMessages');
  const messageInput = $('messageInput');
  const sendBtn = $('sendBtn');
  const closeBtn = $('closeBtn');

  // Load persisted chat
  let chatHistory = JSON.parse(localStorage.getItem(storageKey) || '[]');
  renderChatHistory();

  let isOpen = false;
  chatBubble.onclick = toggleChat;
  closeBtn.onclick = toggleChat;
  sendBtn.onclick = sendMessage;
  messageInput.oninput = () => sendBtn.disabled = !messageInput.value.trim();
  messageInput.onkeypress = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  function toggleChat() {
    isOpen = !isOpen;
    chatBubble.style.display = isOpen ? 'none' : 'flex';
    chatWindow.style.display = isOpen ? 'flex' : 'none';
    if (isOpen) messageInput.focus();
  }

  function formatMessage(text) {
    return text.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/- (.*?)(<br>|$)/g, '• $1<br>').replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
  }

  function addMessage(text, isUser, receipt = null) {
    const message = { text, isUser, receipt, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    chatHistory.push(message);
    localStorage.setItem(storageKey, JSON.stringify(chatHistory));
    renderMessage(message);
  }

  function renderChatHistory() {
    chatMessages.innerHTML = '';
    chatHistory.forEach(renderMessage);
  }

  function renderMessage(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.isUser ? 'user' : 'bot'}`;
    div.innerHTML = `
      <div>${formatMessage(msg.text)}</div>
      <div class="message-time">${msg.timestamp}</div>
      ${msg.isUser ? `<span class="receipt">${msg.receipt || '✓ Sent'}</span>` : ''}
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    messageInput.value = '';
    sendBtn.disabled = true;

    // Add user message with "sent"
    addMessage(text, true, '✓ Sent');

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: crypto.randomUUID(), domain: window.location.hostname })
      });
      const data = await response.json();

      // Update last user message receipt to "✓✓ Read"
      chatHistory = chatHistory.map((m, i) => (i === chatHistory.length - 1 && m.isUser ? { ...m, receipt: '✓✓ Read' } : m));
      localStorage.setItem(storageKey, JSON.stringify(chatHistory));
      renderChatHistory();

      // Add bot message
      addMessage(data.reply || 'Sorry, no response received.', false);
    } catch (err) {
      addMessage('⚠️ Error sending message.', false);
    }
  }
})();
