/**
 * ============================================================================
 * SENSIMONITOR - CONFIGURAÇÃO GLOBAL DAS PÁGINAS (/frontend/pages/config.js)
 * ============================================================================
 * Ponto de entrada compatível com todas as páginas da aplicação.
 * Centraliza URLs de API, resolução dinâmica de caminhos relativos,
 * interceptor HTTP 401, formatação comum e filtro de menu por vínculos.
 */
(function (global) {
    'use strict';

    // 1. Definição de Ambiente e URLs da API
    const hostname = global.location.hostname;
    const protocol = global.location.protocol;
    const isLocalhost =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        protocol === 'file:' ||
        hostname === '';

    const EC2_API_URL = 'https://api.sensimonitor.com.br';
    const LOCAL_API_URL = 'http://localhost:3000';

    const EC2_LLM_URL = 'https://ai.sensimonitor.com.br/api';
    const LOCAL_LLM_URL = 'https://ai.sensimonitor.com.br/api';

    global.API_BASE = isLocalhost ? LOCAL_API_URL : EC2_API_URL;
    global.LLM_API_BASE = isLocalhost ? LOCAL_LLM_URL : EC2_LLM_URL;

    console.log('[Config] API_BASE configurado para:', global.API_BASE);
    console.log('[Config] LLM_API_BASE configurado para:', global.LLM_API_BASE);

    // Modo demonstração: dados simulados só aparecem com ?demo=1 na URL.
    // Sem ele, as telas mostram apenas dados reais (ou estado vazio).
    let demo = false;
    try { demo = new URLSearchParams(global.location.search).get('demo') === '1'; } catch (e) {}
    global.SENSORIUM_DEMO = demo;

    /**
     * Resolve o caminho relativo até a pasta `/pages/` a partir da URL atual.
     * Suporta páginas de 1º nível (`/pages/chopeiras/`) e de 2º nível (`/pages/lfg60/coworking/`).
     */
    function resolvePagePath(targetRelativeToPages) {
        const cleanTarget = String(targetRelativeToPages || '').replace(/^\/+/, '');
        const pathname = (global.location.pathname || '').replace(/\\/g, '/');
        const pagesIdx = pathname.indexOf('/pages/');

        if (pagesIdx === -1) {
            if (pathname.includes('/frontend/')) {
                return `pages/${cleanTarget}`;
            }
            return `frontend/pages/${cleanTarget}`;
        }

        const afterPages = pathname.slice(pagesIdx + '/pages/'.length);
        const segments = afterPages.split('/').filter(Boolean);
        const folderDepth = Math.max(1, segments.length - 1);
        const prefix = '../'.repeat(folderDepth);

        return `${prefix}${cleanTarget}`;
    }

    global.resolvePagePath = resolvePagePath;

    /**
     * Cabeçalhos padrão de autorização JWT
     */
    function getAuthHeaders(extraHeaders = {}) {
        const token = localStorage.getItem('sensorium_token');
        const headers = { ...extraHeaders };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

    global.getAuthHeaders = getAuthHeaders;

    /**
     * Utilitários Globais de Formatação e Sanitização
     */
    if (typeof global.escapeHtml !== 'function') {
        global.escapeHtml = function escapeHtml(str) {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };
    }

    if (typeof global.formatarDataHoraLeitura !== 'function') {
        global.formatarDataHoraLeitura = function formatarDataHoraLeitura(row) {
            if (!row) return '--';
            const str =
                typeof row === 'string'
                    ? row
                    : row.timestamp_leitura || row.timestamp_formatado || row.timestamp || row.created_at;
            if (!str) return '--';

            const s = String(str).trim();
            if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)) {
                const [datePart, timePart] = s.replace('T', ' ').split(' ');
                const [yyyy, mm, dd] = datePart.split('-');
                return `${dd}/${mm}/${yyyy} ${timePart.slice(0, 8)}`;
            }

            const d = new Date(str);
            if (isNaN(d.getTime())) return String(str);
            return d.toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        };
    }

    if (typeof global.formatDatetimeLocalInput !== 'function') {
        global.formatDatetimeLocalInput = function formatDatetimeLocalInput(d) {
            if (!(d instanceof Date) || isNaN(d.getTime())) return '';
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
        };
    }

    /**
     * Rótulos em português de LED, status e parâmetros (telas LFG60 / Coworking).
     * Aceitam os valores em inglês ou português que vêm do backend.
     */
    if (typeof global.translateLed !== 'function') {
        global.translateLed = function translateLed(led) {
            const v = String(led || '').toLowerCase();
            if (v === 'red' || v === 'vermelho') return 'Vermelho';
            if (v === 'yellow' || v === 'amarelo') return 'Amarelo';
            if (v === 'green' || v === 'verde' || v === '') return 'Verde';
            return String(led);
        };
    }
    if (typeof global.translateStatus !== 'function') {
        global.translateStatus = function translateStatus(st) {
            const v = String(st || '').toLowerCase();
            if (v === 'critical' || v === 'crítico' || v === 'critico') return 'Crítico';
            if (v === 'warning' || v === 'atenção' || v === 'atencao') return 'Atenção';
            if (v === 'operational' || v === 'operacional' || v === '') return 'Operacional';
            return String(st);
        };
    }
    if (typeof global.translateParamKey !== 'function') {
        const PARAMS = {
            temperatura: 'Temperatura', umidade: 'Umidade', co2: 'Dióxido de Carbono (CO2)',
            pm25: 'Partículas Finas (PM2.5)', pm10: 'Partículas Grossas (PM10)',
            voc: 'Compostos Orgânicos Voláteis (VOC)', formaldeido: 'Formaldeído (HCHO)'
        };
        global.translateParamKey = function translateParamKey(key) {
            return PARAMS[key] || key;
        };
    }

    /**
     * Alterna o Dropdown de Dispositivos na Sidebar
     */
    if (typeof global.toggleNavDropdown !== 'function') {
        global.toggleNavDropdown = function toggleNavDropdown(btn) {
            if (!btn) return;
            const dropdown = btn.closest('.nav-dropdown');
            if (dropdown) {
                dropdown.classList.toggle('open');
            }
        };
    }

    /**
     * Tratamento global de sessão expirada (HTTP 401).
     */
    if (!global.__fetch401Patched) {
        global.__fetch401Patched = true;

        const _fetch = global.fetch.bind(global);
        let redirecting = false;

        global.fetch = async function (...args) {
            const res = await _fetch(...args);
            try {
                const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
                const naPaginaDeLogin = global.location.pathname.includes('/login/');
                const ehRotaDeLogin = url.includes('/login');

                if (res.status === 401 && !redirecting && !ehRotaDeLogin && !naPaginaDeLogin) {
                    redirecting = true;
                    console.warn('[Auth] Sessão expirada (401). Redirecionando para o login...');
                    try {
                        localStorage.removeItem('sensorium_token');
                        localStorage.removeItem('sensorium_user');
                        sessionStorage.clear();
                    } catch (e) {}
                    global.location.href = resolvePagePath('login/index.html');
                }
            } catch (e) {
                // Nunca interrompe a resposta original
            }
            return res;
        };
    }

    /**
     * Filtro Global de Páginas e Dispositivos por Perfil / Vínculo
     */
    async function aplicarFiltroMenuPorVinculos() {
        const path = global.location.pathname;
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

        if (user.perfil === 'apresentacao') {
            document.querySelectorAll('.sidebar nav > a.nav-item').forEach(el => {
                el.style.display = 'none';
            });
        }

        if (user.perfil === 'superadmin') {
            return;
        }

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
                const res = await global.fetch(`${global.API_BASE}/api/meus-vinculos`, {
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

        const routeCategoryMap = [
            { key: 'chopeiras', pattern: /chopeiras/i },
            { key: 'lfg60', pattern: /lfg60/i },
            { key: 'incendio', pattern: /incendio/i },
            { key: 'pressurizacao', pattern: /pressurizacao/i },
            { key: 'hidraulico', pattern: /hidraulico/i }
        ];

        const subitems = document.querySelectorAll('.nav-dropdown-menu .nav-subitem');
        let visibleCount = 0;

        subitems.forEach(link => {
            const href = link.getAttribute('href') || '';
            const currentFolder = global.location.pathname;

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

        const dropdown = document.querySelector('.nav-dropdown');
        if (dropdown && visibleCount === 0) {
            dropdown.style.display = 'none';
        }

        const currentCategory = routeCategoryMap.find(item => item.pattern.test(global.location.pathname))?.key;
        if (currentCategory && vinculos[currentCategory] === false && user.perfil === 'apresentacao') {
            const availableCategory = routeCategoryMap.find(item => vinculos[item.key] === true)?.key;
            if (availableCategory) {
                const targetUrl = resolvePagePath(`${availableCategory}/index.html`);
                console.log(`[Menu] Redirecionando para categoria com dispositivos vinculados: ${targetUrl}`);
                global.location.href = targetUrl;
            }
        }
    }

    global.aplicarFiltroMenuPorVinculos = aplicarFiltroMenuPorVinculos;

    document.addEventListener('DOMContentLoaded', () => {
        aplicarFiltroMenuPorVinculos();
    });
})(window);
