(function () {
  const apiEndpoint = 'https://2db2ce3daa96.ngrok-free.app/api/chat'; 

  let sessionId = localStorage.getItem('moaawen_session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem('moaawen_session_id', sessionId);
  }

  // Inject Bootstrap + FontAwesome (only once)
  const cssLinks = [
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
  ];
  cssLinks.forEach(link => {
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = link;
    document.head.appendChild(el);
  });

  const style = document.createElement('style');
  style.textContent = ` body {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            min-height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .chat-widget {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 1050;
        }

        .chat-bubble {
            width: 60px;
            height: 60px;
            background: linear-gradient(135deg, #007bff 0%, #6f42c1 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 8px 32px rgba(0, 123, 255, 0.3);
            transition: all 0.3s ease;
            position: relative;
            animation: pulse 2s infinite;
        }

        .chat-bubble:hover {
            transform: scale(1.1);
            box-shadow: 0 12px 40px rgba(0, 123, 255, 0.4);
        }

        .chat-bubble i {
            color: white;
            font-size: 24px;
        }

        .notification-dot {
            position: absolute;
            top: -2px;
            right: -2px;
            width: 12px;
            height: 12px;
            background: #dc3545;
            border-radius: 50%;
            animation: bounce 1s infinite;
        }

        .chat-tooltip {
            position: absolute;
            bottom: 100%;
            right: 0;
            margin-bottom: 8px;
            padding: 8px 12px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            border-radius: 8px;
            font-size: 14px;
            white-space: nowrap;
            opacity: 0;
            transition: opacity 0.2s;
            pointer-events: none;
        }

        .chat-bubble:hover .chat-tooltip {
            opacity: 1;
        }

        .chat-window {
            width: 350px;
            height: 500px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
            display: none;
            flex-direction: column;
            overflow: hidden;
            animation: scaleIn 0.2s ease-out;
        }

        .chat-header {
            background: linear-gradient(135deg, #007bff 0%, #6f42c1 100%);
            color: white;
            padding: 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .chat-header-info {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .chat-avatar {
            width: 32px;
            height: 32px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .chat-status {
            font-size: 12px;
            opacity: 0.8;
        }

        .close-btn {
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            transition: background-color 0.2s;
        }

        .close-btn:hover {
            background: rgba(255, 255, 255, 0.2);
        }

        .chat-messages {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
            background: #f8f9fa;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .message {
            max-width: 80%;
            padding: 12px 16px;
            border-radius: 16px;
            font-size: 14px;
            line-height: 1.4;
        }

        .message.user {
            align-self: flex-end;
            background: linear-gradient(135deg, #007bff 0%, #6f42c1 100%);
            color: white;
            border-bottom-right-radius: 4px;
        }

        .message.bot {
            align-self: flex-start;
            background: white;
            color: #333;
            border: 1px solid #e9ecef;
            border-bottom-left-radius: 4px;
        }

        .message-time {
            font-size: 11px;
            opacity: 0.7;
            margin-top: 4px;
        }

        .typing-indicator {
            align-self: flex-start;
            background: white;
            border: 1px solid #e9ecef;
            border-radius: 16px;
            border-bottom-left-radius: 4px;
            padding: 12px 16px;
            display: none;
        }

        .typing-dots {
            display: flex;
            gap: 4px;
        }

        .typing-dot {
            width: 8px;
            height: 8px;
            background: #6c757d;
            border-radius: 50%;
            animation: typingBounce 1.4s infinite ease-in-out;
        }

        .typing-dot:nth-child(2) {
            animation-delay: 0.2s;
        }

        .typing-dot:nth-child(3) {
            animation-delay: 0.4s;
        }

        .chat-input {
            padding: 16px;
            border-top: 1px solid #e9ecef;
            background: white;
        }

        .input-group {
            display: flex;
            gap: 8px;
            align-items: flex-end;
        }

        .message-input {
            flex: 1;
            color:white;
            border: 1px solid #e9ecef;
            border-radius: 12px;
            padding: 12px 16px;
            font-size: 14px;
            resize: none;
            outline: none;
            transition: border-color 0.2s;
        }

        .message-input:focus {
            border-color: #007bff;
            box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
        }

        .send-btn {
            background: linear-gradient(135deg, #007bff 0%, #6f42c1 100%);
            border: none;
            border-radius: 12px;
            padding: 12px;
            color: white;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .send-btn:hover:not(:disabled) {
            transform: scale(1.05);
        }

        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }

        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-4px); }
        }

        @keyframes scaleIn {
            0% { transform: scale(0.95); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
        }

        @keyframes typingBounce {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1); }
        }

        /* Demo page styles */
        .demo-content {
            max-width: 800px;
            margin: 0 auto;
            padding: 80px 20px;
            text-align: center;
        }

        .demo-title {
            font-size: 3rem;
            font-weight: bold;
            background: linear-gradient(135deg, #007bff 0%, #6f42c1 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 24px;
        }

        .demo-subtitle {
            font-size: 1.25rem;
            color: #6c757d;
            margin-bottom: 48px;
        }

        .feature-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 24px;
            margin-bottom: 48px;
        }

        .feature-card {
            background: white;
            padding: 32px;
            border-radius: 16px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
            border: 1px solid #e9ecef;
        }

        @media (max-width: 576px) {
            .chat-window {
                width: calc(100vw - 32px);
                height: calc(100vh - 100px);
            }
            
            .chat-widget {
                bottom: 16px;
                right: 16px;
            }
        }`;
  document.head.appendChild(style);

  // Inject HTML widget
  const html = `
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
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);

  // Widget logic
  const $ = (id) => document.getElementById(id);
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
