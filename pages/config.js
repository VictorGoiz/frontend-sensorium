/**
 * Arquivo de configuração global do Frontend
 * Centraliza a definição da URL da API do Backend.
 */

// Se estiver rodando na Vercel (ou outro domínio), não será localhost.
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:' || window.location.hostname === '';

// ATENÇÃO (DEPLOY VERCEL):
// O frontend na Vercel roda sempre em HTTPS.
// Portanto, sua API na EC2 OBRIGATORIAMENTE precisa ter HTTPS e um Domínio configurados!
// Substitua o valor abaixo pela URL HTTPS da sua EC2
const EC2_API_URL = 'https://api.sensimonitor.com.br';

// Se o Node.js estiver rodando na porta 3000 localmente
const LOCAL_API_URL = 'http://localhost:3000';

window.API_BASE = isLocalhost ? LOCAL_API_URL : EC2_API_URL;

console.log('[Config] API_BASE configurado para:', window.API_BASE);

/**
 * Tratamento global de sessão expirada (HTTP 401).
 * Intercepta TODAS as chamadas fetch da aplicação: se a API responder 401
 * (token expirado, inválido ou ausente), limpa a sessão e redireciona ao login
 * uma única vez. O redirecionamento encerra automaticamente o polling e o
 * Socket.IO da página (o contexto é descarregado ao navegar).
 *
 * Exceções: a própria rota de /login (que retorna 401 em credencial inválida)
 * e a página de login não disparam o redirecionamento, para não criar laço nem
 * apagar a mensagem de erro de login.
 */
(function () {
    if (window.__fetch401Patched) return;
    window.__fetch401Patched = true;

    const _fetch = window.fetch.bind(window);
    let redirecting = false;

    window.fetch = async function (...args) {
        const res = await _fetch(...args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            const naPaginaDeLogin = window.location.pathname.includes('/login/');
            const ehRotaDeLogin = url.includes('/login');

            if (res.status === 401 && !redirecting && !ehRotaDeLogin && !naPaginaDeLogin) {
                redirecting = true;
                console.warn('[Auth] Sessão expirada (401). Redirecionando para o login...');
                try {
                    localStorage.removeItem('sensorium_token');
                    localStorage.removeItem('sensorium_user');
                } catch (e) {}
                window.location.href = '../login/index.html';
            }
        } catch (e) {
            // Nunca deixa o interceptor quebrar a resposta original.
        }
        return res;
    };
})();
