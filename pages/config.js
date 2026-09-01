/**
 * Arquivo de configuração global do Frontend
 * Centraliza a definição da URL da API do Backend.
 */

// Se estiver rodando na Vercel (ou outro domínio), não será localhost.
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:' || window.location.hostname === '';

// ATENÇÃO (DEPLOY VERCEL): 
// O frontend na Vercel roda sempre em HTTPS.
// Portanto, sua API na EC2 OBRIGATORIAMENTE precisa ter HTTPS e um Domínio configurados!
// Substitua o valor abaixo pela URL HTTPS da sua EC2 (ex: 'https://api.seudominio.com.br')
const EC2_API_URL = 'https://COLOQUE_SUA_URL_DA_EC2_AQUI'; 

// Se o Node.js estiver rodando na porta 3000 localmente
const LOCAL_API_URL = 'http://localhost:3000';

window.API_BASE = isLocalhost ? LOCAL_API_URL : EC2_API_URL;

console.log('[Config] API_BASE configurado para:', window.API_BASE);
