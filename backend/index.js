require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const faqData = require('./data/faq.json');
const stringSimilarity = require('string-similarity');
const natural = require('natural');
const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmer;

// Configuration
const config = {
  port: process.env.PORT || 3000,
  openRouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: process.env.OPENROUTER_API_KEY,
    models: {
      gpt3: "openai/gpt-3.5-turbo",
      claude: "anthropic/claude-2"
    }
  },
  security: {
    rateLimit: {
      windowMs: 15 * 60 * 1000,
      max: 100
    }
  }
};

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3000', 'https://siirt.edu.tr'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

app.use(express.json());
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit(config.security.rateLimit);
app.use(limiter);

// Serve static files from frontend
app.use(express.static(path.join(__dirname, '../frontend'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    } else if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));
// Create HTTP server
const server = http.createServer(app);

// Configure Socket.IO
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 60000
  }
});

// NLP functions
function preprocessText(text) {
  const tokens = tokenizer.tokenize(text.toLowerCase());
  return tokens.map(token => stemmer.stem(token));
}

function findBestFAQMatch(userInput) {
  const processedInput = preprocessText(userInput).join(' ');
  const questions = faqData.map(item => ({
    original: item.question,
    processed: preprocessText(item.question).join(' ')
  }));
  
  const matches = stringSimilarity.findBestMatch(
    processedInput, 
    questions.map(q => q.processed)
  );
  
  if (matches.bestMatch.rating > 0.65) {
    return {
      ...faqData.find(item => item.question === questions[matches.bestMatchIndex].original),
      rating: matches.bestMatch.rating
    };
  }
  return null;
}

// AI response handler
async function getAIResponse(message, context = []) {
  try {
    // تحويل الأدوار غير المدعومة إلى أدوار مدعومة
    const supportedContext = context.map(msg => ({
      ...msg,
      role: msg.role === 'bot' ? 'assistant' : msg.role
    }));

    const response = await axios.post(config.openRouter.url, {
      model: config.openRouter.models.gpt3,
      messages: [
        {
          role: "system",
          content: "Sen Siirt Üniversitesi'nin resmi asistanısın. Sadece üniversiteyle ilgili konularda yardımcı ol."
        },
        ...supportedContext.filter(msg => 
          ['system', 'user', 'assistant'].includes(msg.role)
        ),
        { role: "user", content: message }
      ],
      temperature: 0.7,
      max_tokens: 500
    }, {
      headers: {
        'Authorization': `Bearer ${config.openRouter.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (!response.data?.choices?.[0]?.message?.content) {
      throw new Error('Geçersiz API yanıtı');
    }

    return {
      text: response.data.choices[0].message.content,
      model: response.data.model,
      usage: response.data.usage
    };
  } catch (error) {
    console.error("API Hatası:", error.response?.data || error.message);
    return {
      text: "Üzgünüm, bir hata oluştu. Lütfen daha sonra tekrar deneyin.",
      error: true
    };
  }
}

// Session management
const userSessions = new Map();

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);
  
  // Initialize user session
  userSessions.set(socket.id, {
    id: socket.id,
    ip: socket.handshake.address,
    joinedAt: new Date(),
    conversationHistory: [{
      role: 'bot',
      content: 'Merhaba! Ben Siirt Üniversitesi\'nin sanal asistanıyım. Size nasıl yardımcı olabilirim?',
      timestamp: new Date()
    }]
  });


  // Handle user messages
  socket.on('userMessage', async (msg) => {
    if (!msg || typeof msg !== 'string' || msg.length > 500) {
      return socket.emit('error', 'Geçersiz mesaj formatı veya uzunluğu');
    }
    
    const session = userSessions.get(socket.id);
    session.conversationHistory.push({
      role: 'user',
      content: msg,
      timestamp: new Date()
    });
    
    try {
      // Check FAQ first
      const faqMatch = findBestFAQMatch(msg);
      if (faqMatch) {
        const response = processFAQAnswer(faqMatch.answer);
        session.conversationHistory.push({
          role: 'bot',
          content: response,
          source: 'faq',
          timestamp: new Date()
        });
        return socket.emit('botResponse', {
          type: 'faq',
          content: response,
          metadata: {
            question: faqMatch.question,
            confidence: faqMatch.rating
          }
        });
      }
      
      // Get AI response if no FAQ match
      const aiResponse = await getAIResponse(msg, session.conversationHistory);
      session.conversationHistory.push({
        role: 'bot',
        content: aiResponse.text,
        source: 'ai',
        model: aiResponse.model,
        timestamp: new Date()
      });
      
      socket.emit('botResponse', {
        type: 'ai',
        content: aiResponse.text,
        metadata: {
          model: aiResponse.model,
          usage: aiResponse.usage
        }
      });
    } catch (error) {
      console.error('Message processing error:', error);
      socket.emit('error', 'Mesaj işlenirken bir hata oluştu');
    }
  });
  socket.on('botResponse', (response) => {
    // إخفاء مؤشر الكتابة
    hideTypingIndicator(document.querySelector('.typing-indicator'));
    
    // معالجة الرد
    if (response.type === 'rich') {
        addMessageToChat('bot', response.content, 'rich');
    } else {
        addMessageToChat('bot', response.content);
    }
    
    // تحديث الأسئلة المقترحة
    updateFAQSuggestions();
    
    // التمرير إلى الأسفل
    chatContainer.scrollTop = chatContainer.scrollHeight;
});
  // Handle disconnection
  socket.on('disconnect', () => {
    userSessions.delete(socket.id);
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Process FAQ answers
function processFAQAnswer(answer) {
  if (typeof answer === 'object') {
    return {
      type: 'rich',
      ...answer
    };
  }
  return answer.replace(
    /(https?:\/\/[^\s]+)/g, 
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

// API endpoints
app.get('/api/faq', (req, res) => {
  res.json({
    count: faqData.length,
    items: faqData
  });
});

app.post('/api/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Soru gereklidir' });
  }
  
  const faqMatch = findBestFAQMatch(question);
  if (faqMatch) {
    return res.json({
      source: 'faq',
      answer: processFAQAnswer(faqMatch.answer),
      question: faqMatch.question
    });
  }
  
  const aiResponse = await getAIResponse(question);
  res.json({
    source: 'ai',
    answer: aiResponse.text,
    model: aiResponse.model
  });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
server.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}/`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${config.port} is in use, trying alternative port...`);
    server.listen(0, () => {
      console.log(`Server running on http://localhost:${server.address().port}`);
    });
  }
});

// Error handling
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

