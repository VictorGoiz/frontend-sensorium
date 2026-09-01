// Lógica do Painel de Alertas / Chat Inteligente

const chatMessages = [
    { type: 'info-msg', label: 'IA', text: 'Olá! Sou seu assistente inteligente. Como posso ajudar com seus sensores hoje?' }
];

function renderChatMessages() {
    const chatBody = document.getElementById('chatBody');
    if (!chatBody) return;
    
    chatBody.innerHTML = '';
    
    chatMessages.forEach(msg => {
        appendMessageToDOM(msg, chatBody);
    });
}

function appendMessageToDOM(msg, container = null) {
    const chatBody = container || document.getElementById('chatBody');
    if (!chatBody) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${msg.type}`;
    
    const strong = document.createElement('strong');
    strong.textContent = `${msg.label}: `;
    
    msgDiv.appendChild(strong);
    msgDiv.appendChild(document.createTextNode(msg.text));
    
    chatBody.appendChild(msgDiv);
    chatBody.scrollTop = chatBody.scrollHeight; // Rola para o fim
}

async function handleSendMessage() {
    const input = document.getElementById('chatInput');
    const question = input.value.trim();
    if (!question) return;

    // Adiciona a mensagem do usuário
    const userMsg = { type: 'alert-msg', label: 'Você', text: question }; // Usando alert-msg apenas pela cor, ou podemos usar info-msg
    appendMessageToDOM(userMsg);
    input.value = '';

    // Mostra estado de carregamento
    const loadingMsg = { type: 'warning-msg', label: 'IA', text: 'Analisando os sensores...' };
    appendMessageToDOM(loadingMsg);
    
    try {
        // Usa window.API_BASE definido globalmente em config.js
        const response = await fetch(`${API_BASE}/ai/responseAI`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ question })
        });
        
        const data = await response.json();
        
        // Remove a mensagem de carregamento (último elemento)
        const chatBody = document.getElementById('chatBody');
        if (chatBody && chatBody.lastChild) {
            chatBody.removeChild(chatBody.lastChild);
        }

        if (response.ok) {
            appendMessageToDOM({ type: 'info-msg', label: 'IA', text: data.response || data.response.text || data.response });
        } else {
            appendMessageToDOM({ type: 'alert-msg', label: 'Erro', text: data.erro || 'Erro ao consultar a IA.' });
        }
    } catch (error) {
        console.error('Erro na requisição para a IA:', error);
        const chatBody = document.getElementById('chatBody');
        if (chatBody && chatBody.lastChild) {
            chatBody.removeChild(chatBody.lastChild);
        }
        appendMessageToDOM({ type: 'alert-msg', label: 'Erro', text: 'Falha na comunicação com o servidor.' });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    renderChatMessages();

    const sendBtn = document.getElementById('chatSendBtn');
    const input = document.getElementById('chatInput');

    if (sendBtn) {
        sendBtn.addEventListener('click', handleSendMessage);
    }
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSendMessage();
        });
    }
});

function toggleChat() {
    const sidebar = document.getElementById('chatSidebar');
    const overlay = document.getElementById('chatOverlay');
    
    if (sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    } else {
        sidebar.classList.add('open');
        overlay.classList.add('active');
    }
}
