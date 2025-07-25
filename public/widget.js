(function () {
  const apiEndpoint = 'https://moaawen.onrender.com/api/chat';

  let sessionId = localStorage.getItem('moaawen_session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem('moaawen_session_id', sessionId);
  }

  // Create root container
  let root = document.getElementById('moaawen-widget-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'moaawen-widget-root';
    document.body.appendChild(root);
  }

  // Attach Shadow DOM
  const shadow = root.attachShadow({ mode: 'open' });

  // Load CSS into Shadow DOM
  const cssLinks = [
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
  ];
  cssLinks.forEach(link => {
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = link;
    shadow.appendChild(el);
  });

  // Add widget styles to Shadow DOM
  const style = document.createElement('style');
  style.textContent = `
    /* Your entire CSS as before (chat-widget, chat-bubble, etc.) */
    .chat-widget { position: fixed; bottom: 24px; right: 24px; z-index: 1050; }
    .chat-bubble { width: 60px; height: 60px; background: linear-gradient(135deg, #007bff 0%, #6f42c1 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 8px 32px rgba(0, 123, 255, 0.3); transition: all 0.3s ease; position: relative; animation: pulse 2s infinite; }
    .chat-bubble:hover { transform: scale(1.1); box-shadow: 0 12px 40px rgba(0, 123, 255, 0.4); }
    .chat-bubble i { color: white; font-size: 24px; }
    /* ... rest of your styles ... */
  `;
  shadow.appendChild(style);

  // Widget HTML (same as your original but without container wrapper)
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="chat-widget">
      <div class="chat-bubble" id="chatBubble">
        <i class="fas fa-comment"></i>
        <div class="notification-dot"></div>
        <div class="chat-tooltip">Chat with us!</div>
      </div>
      <div class="chat-window" id="chatWindow">
        <div class="chat-header">
          <div class="chat-header-info">
            <div class="chat-avatar"><i class="fas fa-comment" style="font-size: 14px;"></i></div>
            <div><div class="fw-semibold">Chat Assistant</div><div class="chat-status">Online now</div></div>
          </div>
          <button class="close-btn" id="closeBtn"><i class="fas fa-times"></i></button>
        </div>
        <div class="chat-messages" id="chatMessages">
          <div class="message bot">
            <div>Hi there! 👋 Welcome to our chat. How can I help you today?</div>
            <div class="message-time" id="welcomeTime"></div>
          </div>
          <div class="typing-indicator" id="typingIndicator">
            <div class="typing-dots">
              <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
            </div>
          </div>
        </div>
        <div class="chat-input">
          <div class="input-group">
            <textarea class="message-input" id="messageInput" placeholder="Type your message..." rows="1"></textarea>
            <button class="send-btn" id="sendBtn"><i class="fas fa-paper-plane"></i></button>
          </div>
        </div>
      </div>
    </div>
  `;
  shadow.appendChild(container);

  // Query elements inside Shadow DOM
  const $ = (id) => shadow.getElementById(id);
  const chatBubble = $('chatBubble');
  const chatWindow = $('chatWindow');
  const chatMessages = $('chatMessages');
  const messageInput = $('messageInput');
  const sendBtn = $('sendBtn');
  const closeBtn = $('closeBtn');
  const typingIndicator = $('typingIndicator');
  $('welcomeTime').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let isOpen = false;

  chatBubble.onclick = toggleChat;
  closeBtn.onclick = toggleChat;
  sendBtn.onclick = sendMessage;
  messageInput.oninput = () => updateSendButton();
  messageInput.onkeypress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  function toggleChat() {
    isOpen = !isOpen;
    chatBubble.style.display = isOpen ? 'none' : 'flex';
    chatWindow.style.display = isOpen ? 'flex' : 'none';
    if (isOpen) messageInput.focus();
  }

  function addMessage(text, isUser) {
    const msg = document.createElement('div');
    msg.className = `message ${isUser ? 'user' : 'bot'}`;
    msg.innerHTML = `<div>${text}</div><div class="message-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`;
    chatMessages.insertBefore(msg, typingIndicator);
    scrollToBottom();
  }

  function scrollToBottom() {
    setTimeout(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);
  }

  function showTyping() {
    typingIndicator.style.display = 'block';
    scrollToBottom();
  }

  function hideTyping() {
    typingIndicator.style.display = 'none';
  }

  function updateSendButton() {
    sendBtn.disabled = !messageInput.value.trim();
    autoResizeTextarea();
  }

  function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  }

  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    addMessage(text, true);
    messageInput.value = '';
    updateSendButton();
    showTyping();

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId,
          domain: window.location.hostname || 'localhost'
        })
      });

      const data = await response.json();
      hideTyping();
      addMessage(data.reply || 'Sorry, no response received.', false);
    } catch (err) {
      hideTyping();
      addMessage('⚠️ Error sending message.', false);
    }
  }
})();
