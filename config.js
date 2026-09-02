/**
 * Arquivo de configuração global do Frontend
 * Centraliza a definição da URL da API do Backend.
 */

// Se estiver rodando na Vercel (ou outro domínio), não será localhost.
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:' || window.location.hostname === '';

// URL da API na AWS EC2 (com certificado SSL/HTTPS)
const EC2_API_URL = 'https://api.sensimonitor.com.br'; 

// Se o Node.js estiver rodando localmente
const LOCAL_API_URL = 'http://localhost:3000';

window.API_BASE = isLocalhost ? LOCAL_API_URL : EC2_API_URL;

console.log('[Config] API_BASE configurado para:', window.API_BASE);
