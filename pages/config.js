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
                    sessionStorage.clear();
                } catch (e) {}
                window.location.href = '../login/index.html';
            }
        } catch (e) {
            // Nunca deixa o interceptor quebrar a resposta original.
        }
        return res;
    };
})();

/**
 * Filtro Global de Páginas e Dispositivos por Perfil / Vínculo
 * Executado em todas as páginas para garantir que usuários vinculados a uma
 * empresa visualizem apenas as categorias de dispositivos que possuem unidades
 * reais vinculadas à sua conta.
 */
async function aplicarFiltroMenuPorVinculos() {
    const path = window.location.pathname;
    if (path.includes('/login/')) return;

    const userStr = localStorage.getItem('sensorium_user');
    const token = localStorage.getItem('sensorium_token');
    if (!userStr || !token) return;

    let user = null;
    try {
        user = JSON.parse(userStr);
    } catch (e) {
        return;
    }

    // Se for o perfil de apresentação, oculta os itens gerais do topo da sidebar
    if (user.perfil === 'apresentacao') {
        document.querySelectorAll('.sidebar nav > a.nav-item').forEach(el => {
            el.style.display = 'none';
        });
    }

    // Superadmin visualiza todas as páginas e dispositivos sem restrições
    if (user.perfil === 'superadmin') {
        return;
    }

    // Consulta os vínculos do usuário (com cache na sessão)
    let vinculos = null;
    let counts = null;
    const cacheKey = `sensorium_vinculos_${user.id || user.email}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            vinculos = parsed.vinculos;
            counts = parsed.counts;
        } catch (e) {}
    }

    if (!vinculos) {
        try {
            const res = await window.fetch(`${window.API_BASE}/api/meus-vinculos`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.vinculos) {
                    vinculos = data.vinculos;
                    counts = data.counts;
                    sessionStorage.setItem(cacheKey, JSON.stringify({ vinculos, counts }));
                }
            }
        } catch (err) {
            console.warn('[Menu] Não foi possível consultar vínculos do perfil:', err.message);
        }
    }

    if (!vinculos) return;

    // Mapeamento das rotas para as categorias
    const routeCategoryMap = [
        { key: 'chopeiras', pattern: /chopeiras/i },
        { key: 'lfg60', pattern: /lfg60/i },
        { key: 'incendio', pattern: /incendio/i },
        { key: 'pressurizacao', pattern: /pressurizacao/i },
        { key: 'hidraulico', pattern: /hidraulico/i }
    ];

    // 1. Filtra os subitens dentro do menu dropdown
    const subitems = document.querySelectorAll('.nav-dropdown-menu .nav-subitem');
    let visibleCount = 0;

    subitems.forEach(link => {
        const href = link.getAttribute('href') || '';
        const currentFolder = window.location.pathname;

        for (const item of routeCategoryMap) {
            const isMatch = item.pattern.test(href) || (href === 'index.html' && item.pattern.test(currentFolder));
            if (isMatch) {
                if (vinculos[item.key] === false) {
                    link.style.display = 'none';
                } else {
                    link.style.display = '';
                    visibleCount++;
                }
                break;
            }
        }
    });

    // Se nenhum dispositivo estiver vinculado em nenhuma categoria, oculta o dropdown inteiro
    const dropdown = document.querySelector('.nav-dropdown');
    if (dropdown && visibleCount === 0) {
        dropdown.style.display = 'none';
    }

    // 2. Se a página atual pertencer a uma categoria que NÃO possui dispositivos vinculados
    // e o usuário estiver no perfil de apresentação, redireciona suavemente para a primeira página com vínculo
    const currentCategory = routeCategoryMap.find(item => item.pattern.test(window.location.pathname))?.key;
    if (currentCategory && vinculos[currentCategory] === false && user.perfil === 'apresentacao') {
        const availableCategory = routeCategoryMap.find(item => vinculos[item.key] === true)?.key;
        if (availableCategory) {
            const targetUrl = `../${availableCategory}/index.html`;
            console.log(`[Menu] Redirecionando para categoria com dispositivos vinculados: ${targetUrl}`);
            window.location.href = targetUrl;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    aplicarFiltroMenuPorVinculos();
});
