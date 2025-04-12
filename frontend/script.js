  // استبدال اتصال السوكيت بهذا:
const socket = io('http://localhost:3000', {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    transports: ['websocket', 'polling'],
    upgrade: true,
    rememberUpgrade: true
  });
  
  // إضافة مستمع لرسالة التأكيد
  socket.on('connection_ack', (data) => {
    console.log('Server connection acknowledgment:', data);
    addMessageToChat('bot', data.message);
  });
  
  // إضافة مستمع لأحداث الاتصال
  socket.on('connect', () => {
    console.log('Connected to server');
    document.querySelector('.status-indicator').style.backgroundColor = '#4CAF50';
    document.querySelector('.chat-status span:last-child').textContent = 'Çevrimiçi';
  });
  
  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    document.querySelector('.status-indicator').style.backgroundColor = '#f44336';
    document.querySelector('.chat-status span:last-child').textContent = 'Çevrimdışı';
  });
  
  socket.on('connect_error', (err) => {
    console.error('Connection error:', err);
    addMessageToChat('bot', `Bağlantı hatası: ${err.message}`);
  });

// DOM elementleri
const chatContainer = document.getElementById('chat-container');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const faqSuggestions = document.getElementById('faq-suggestions');

function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;

  // عرض الرسالة فوراً
  addMessageToChat('user', message);
  messageInput.value = '';

  socket.emit('userMessage', message, (ack) => {
    console.log('Server acknowledgment:', ack);
    if (!ack || !ack.status === 'received') {
      addMessageToChat('bot', 'تعذر إرسال الرسالة، يرجى المحاولة لاحقاً');
    }
  });
  showTypingIndicator();

}
// Mesajı sohbete ekle
function addMessageToChat(sender, content, type = 'text') {
    const messageElement = document.createElement('div');
    
    if (type === 'rich') {
        messageElement.className = 'rich-message';
        messageElement.innerHTML = `
            <h3>${content.title || 'Siirt Üniversitesi'}</h3>
            ${content.image ? `<img src="${content.image}" alt="Üniversite Görseli">` : ''}
            <p>${content.text}</p>
            ${content.social ? `
                <div class="social-links">
                    ${Object.entries(content.social).map(([name, url]) => `
                        <a href="${url}" target="_blank">
                            <i class="fas fa-external-link-alt"></i>
                            ${name}
                        </a>
                    `).join('')}
                </div>
            ` : ''}
        `;
    } else {
        messageElement.className = sender === 'user' ? 'user-message message' : 'bot-message message';
        messageElement.textContent = content;
    }
    
    chatContainer.appendChild(messageElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Yazıyor animasyonu
function showTypingIndicator() {
    const typingElement = document.createElement('div');
    typingElement.className = 'typing-indicator';
    typingElement.innerHTML = `
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <span style="margin-left: 10px;">Yazıyor...</span>
    `;
    chatContainer.appendChild(typingElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return typingElement;
}

// Yazıyor animasyonunu kaldır
function hideTypingIndicator(element) {
    if (element && element.parentNode) {
        element.parentNode.removeChild(element);
    }
}

// Sunucudan gelen yanıtları dinle
socket.on('botResponse', (response) => {
    // Yazıyor animasyonunu kaldır
    const typingIndicators = document.querySelectorAll('.typing-indicator');
    typingIndicators.forEach(indicator => {
        chatContainer.removeChild(indicator);
    });
    
    // Yanıtı işle
    if (response.type === 'rich') {
        addMessageToChat('bot', response.content, 'rich');
    } else {
        addMessageToChat('bot', response.content);
    }
    
    // Önerileri güncelle
    updateFAQSuggestions();
});

// Hata durumunda
socket.on('error', (error) => {
    const typingIndicators = document.querySelectorAll('.typing-indicator');
    typingIndicators.forEach(indicator => {
        chatContainer.removeChild(indicator);
    });
    
    addMessageToChat('bot', `Hata: ${error}`);
});

// Bağlantı durumu
socket.on('connect', () => {
    console.log('Sunucuya bağlandı');
});

socket.on('disconnect', () => {
    addMessageToChat('bot', 'Bağlantı kesildi. Lütfen sayfayı yenileyin.');
});

// FAQ önerilerini güncelle
function updateFAQSuggestions() {
    // Bu örnek için sabit veri kullanıyoruz
    const faqItems = [
        { question: "Kayıt yenileme nasıl yapılır?", answer: "Kayıt yenileme işlemleri OBS sisteminden yapılır." },
        { question: "Yaz okulu tarihleri ne zaman?", answer: "Yaz okulu tarihleri akademik takvimde yayınlanır." },
        { question: "Burs başvuruları nasıl yapılır?", answer: "Burs başvuruları öğrenci işleri tarafından duyurulur." },
        { question: "Ders programına nasıl ulaşabilirim?", answer: "Ders programınıza OBS sisteminden ulaşabilirsiniz." }
    ];
    
    const randomFAQs = getRandomItems(faqItems, 4);
    faqSuggestions.innerHTML = randomFAQs.map(faq => `
        <div class="faq-suggestion" onclick="askQuestion('${faq.question.replace(/'/g, "\\'")}')">
            ${faq.question}
        </div>
    `).join('');
}

// Rastgele FAQ seç
function getRandomItems(arr, num) {
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, num);
}

// Önerilen soruyu sorma
function askQuestion(question) {
    // تعبئة حقل الإدخال بالسؤال المختار
    messageInput.value = question;
    
    // إنشاء عنصر رسالة المستخدم وإضافته مباشرة
    const userMessage = document.createElement('div');
    userMessage.className = 'user-message message';
    userMessage.textContent = question;
    chatContainer.appendChild(userMessage);
    
    // مسح حقل الإدخال
    messageInput.value = '';
    
    // إظهار مؤشر "يكتب..."
    const typingIndicator = showTypingIndicator();
    
    // إرسال الرسالة إلى الخادم
    socket.emit('userMessage', question, (ack) => {
        if (!ack || ack.status !== 'received') {
            hideTypingIndicator(typingIndicator);
            addMessageToChat('bot', 'تعذر إرسال السؤال، يرجى المحاولة مرة أخرى');
        }
    });
    
    // التمرير إلى الأسفل
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Global fonksiyonlar
window.sendMessage = sendMessage;
window.askQuestion = askQuestion;

// Event listeners
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// Sayfa yüklendiğinde FAQ önerilerini getir
document.addEventListener('DOMContentLoaded', () => {
    updateFAQSuggestions();
});