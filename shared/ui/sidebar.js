/**
 * ============================================================================
 * SENSIMONITOR - MENU LATERAL ÚNICO (UI)
 * ============================================================================
 * Gera o conteúdo do <aside class="sidebar"> de todas as páginas a partir de
 * uma única definição, para que textos, ordem e links sejam sempre os mesmos.
 *
 * Uso (script clássico logo depois do aside, antes dos scripts da página):
 *   <aside class="sidebar"></aside>
 *   <script src="../../shared/ui/sidebar.js"></script>
 * Nas páginas de administração: <aside class="sidebar" data-menu="admin">.
 *
 * Mantém as classes .nav-item / .nav-dropdown / .nav-subitem, usadas pelo
 * filtro de vínculos do config.js e pelos estilos existentes.
 */
(function (global) {
    'use strict';

    const script = document.currentScript;
    const aside = script && script.previousElementSibling && script.previousElementSibling.matches('aside.sidebar')
        ? script.previousElementSibling
        : document.querySelector('aside.sidebar');
    if (!aside) return;

    // Raiz do frontend a partir do próprio script (…/shared/ui/sidebar.js)
    const raiz = script ? script.src.replace(/shared\/ui\/sidebar\.js(\?.*)?$/, '') : '';
    const url = (rel) => raiz + 'pages/' + rel;

    const MENU_PRINCIPAL = [
        { texto: 'Visão Geral', href: 'home/index.html' },
        { texto: 'Sensores', href: 'sensores/index.html' },
        { texto: 'Relés', href: 'reles/index.html' },
        {
            texto: 'Dispositivos',
            itens: [
                { texto: 'Chopeiras', href: 'chopeiras/index.html' },
                { texto: 'LFG60', href: 'lfg60/index.html' },
                { texto: 'LFG60 Coworking', href: 'lfg60/coworking/index.html' },
                { texto: 'Sistema de Incêndio', href: 'incendio/index.html' },
                { texto: 'Pressurização de Água', href: 'pressurizacao/index.html' },
                { texto: 'Pressurização Smart Fit', href: 'pressurizacao/smartfit/index.html' },
                { texto: 'Sistema Hidráulico', href: 'hidraulico/index.html' }
            ]
        },
        { texto: 'Administração', href: 'admin/index.html', perfil: 'superadmin' }
    ];

    const MENU_ADMIN = [
        { texto: 'Cadastrar', href: 'admin/index.html' },
        { texto: 'Gerenciar Dispositivos', href: 'admin/dispositivos.html' },
        { texto: 'Relatórios', href: 'admin/relatorios.html' },
        { texto: 'Voltar ao Painel', href: 'home/index.html' }
    ];

    let perfil = '';
    try {
        perfil = (JSON.parse(localStorage.getItem('sensorium_user') || 'null') || {}).perfil || '';
    } catch (e) { /* sem sessão */ }

    const atual = normalizar(global.location.pathname);
    function normalizar(p) {
        return decodeURIComponent(String(p || '')).replace(/\\/g, '/').replace(/\/index\.html$/, '/');
    }
    function ehAtual(rel) {
        try {
            return normalizar(new URL(url(rel), global.location.href).pathname) === atual;
        } catch (e) {
            return false;
        }
    }

    const CHEVRON = '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    function renderItem(item) {
        if (item.perfil && item.perfil !== perfil) return '';
        if (item.itens) {
            const aberto = item.itens.some((s) => ehAtual(s.href));
            const subitens = item.itens.map((s) =>
                `<a href="${url(s.href)}" class="nav-subitem${ehAtual(s.href) ? ' active' : ''}">${s.texto}</a>`
            ).join('\n');
            return `<div class="nav-dropdown${aberto ? ' open' : ''}">`
                + `<button class="nav-dropdown-toggle${aberto ? ' active' : ''}" onclick="toggleNavDropdown(this)"><span>${item.texto}</span>${CHEVRON}</button>\n`
                + `<div class="nav-dropdown-menu">\n${subitens}\n</div></div>`;
        }
        return `<a href="${url(item.href)}" class="nav-item${ehAtual(item.href) ? ' active' : ''}">${item.texto}</a>`;
    }

    const admin = aside.dataset.menu === 'admin';
    const itens = admin ? MENU_ADMIN : MENU_PRINCIPAL;

    aside.innerHTML = `
        <div class="logo-container">
            <img src="${url('img/logo_sensimonitor.png')}" alt="SensiMonitor" class="sidebar-logo">
            ${admin ? '<span class="admin-badge">Admin</span>' : ''}
        </div>
        <nav>
${itens.map(renderItem).join('\n')}
</nav>
        <div class="user-info">
            <a href="${url('login/index.html')}" class="logout-btn" data-sair>Sair</a>
        </div>`;

    const sair = aside.querySelector('[data-sair]');
    if (sair) {
        sair.addEventListener('click', () => {
            try {
                localStorage.removeItem('sensorium_user');
                localStorage.removeItem('sensorium_token');
                Object.keys(sessionStorage).filter((k) => k.startsWith('sensorium_vinculos_')).forEach((k) => sessionStorage.removeItem(k));
            } catch (e) { /* ignora */ }
        });
    }
})(window);
