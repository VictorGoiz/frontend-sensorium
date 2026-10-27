/**
 * ============================================================================
 * SENSIMONITOR - CENTRAL DE AVISOS E ALERTAS DO CABEÇALHO (UI)
 * ============================================================================
 * Gerencia o popover de alertas no topo das páginas (Sensores, Relés, LFG60,
 * Coworking): listagem, filtro por severidade, marcação individual ou em lote
 * como lido e fechamento automático ao clicar fora.
 *
 * Padrão: alertas gerais (/api/alertas). As telas LFG60 chamam
 *   SensoriumAlerts.configure({ basePath: '/api/lfg60/alertas' })
 * em vez de manter uma cópia própria destas funções.
 */
(function (global) {
    'use strict';

    let currentAlerts = [];
    let activeAlertFilter = 'todos';
    let outsideClickBound = false;
    const config = {
        basePath: '/api/alertas',
        onUpdate: null // (naoLidos, alertas) => void — contadores extras da página
    };

    const esc = (v) => (typeof global.escapeHtml === 'function' ? global.escapeHtml(v) : String(v ?? ''));
    const isCritico = (a) => ['critico', 'crítico', 'critical'].includes(String(a.nivel || '').toLowerCase());

    function getHeaders() {
        if (typeof global.getAuthHeaders === 'function') return global.getAuthHeaders();
        const token = localStorage.getItem('sensorium_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    function configure(options = {}) {
        Object.assign(config, options);
    }

    function bindOutsideClick() {
        if (outsideClickBound) return;
        outsideClickBound = true;
        document.addEventListener('click', function (e) {
            const popover = document.getElementById('headerAlertsPopover');
            const alertBtn = document.getElementById('headerAlertBtn');
            if (popover && popover.classList.contains('active')
                && !popover.contains(e.target) && (!alertBtn || !alertBtn.contains(e.target))) {
                popover.classList.remove('active');
            }
        });
    }

    function bindListClicks() {
        const list = document.getElementById('headerAlertsList');
        if (!list || list.dataset.alertsBound) return;
        list.dataset.alertsBound = '1';
        list.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-alert-id]');
            if (btn) markAlertAsRead(btn.dataset.alertId);
        });
    }

    async function fetchAlertsFromApi() {
        bindOutsideClick();
        try {
            const res = await fetch(`${global.API_BASE}${config.basePath}?unreadOnly=true`, { headers: getHeaders() });
            if (!res.ok) throw new Error('Falha ao buscar alertas.');
            const result = await res.json();
            if (!result.success) return;

            currentAlerts = result.data || [];
            const unread = result.summary ? Number(result.summary.unread) : currentAlerts.length;
            updateHeaderAlertBadge(unread);
            renderAlertsList();

            const cardCountAlertas = document.getElementById('cardCountAlertas');
            if (cardCountAlertas) cardCountAlertas.innerText = unread;
            if (typeof config.onUpdate === 'function') config.onUpdate(unread, currentAlerts);
        } catch (err) {
            console.warn('[Alertas] Erro ao carregar alertas:', err.message);
        }
    }

    function updateHeaderAlertBadge(unreadCount) {
        const badge = document.getElementById('headerAlertBadge');
        if (!badge) return;
        badge.innerText = unreadCount;
        badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    }

    function toggleHeaderAlerts() {
        const popover = document.getElementById('headerAlertsPopover');
        if (popover) popover.classList.toggle('active');
    }

    function filterAlerts(filterType, element) {
        activeAlertFilter = filterType;
        document.querySelectorAll('.popover-filters .filter-tab').forEach((t) => t.classList.remove('active'));
        if (element) element.classList.add('active');
        renderAlertsList();
    }

    function renderAlertsList() {
        const list = document.getElementById('headerAlertsList');
        if (!list) return;
        bindListClicks();

        let filtered = currentAlerts;
        if (activeAlertFilter === 'Critico') filtered = currentAlerts.filter(isCritico);
        else if (activeAlertFilter === 'Aviso') filtered = currentAlerts.filter((a) => !isCritico(a));

        if (filtered.length === 0) {
            list.innerHTML = '<div class="alerts-empty">Nenhum aviso ou alerta pendente no momento.</div>';
            return;
        }

        list.innerHTML = filtered.map((a) => {
            const crit = isCritico(a);
            const quando = a.created_at ? new Date(String(a.created_at).replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T')) : null;
            const hora = quando && !isNaN(quando) ? quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
            return `
                <div class="alert-item-card ${crit ? 'critico' : ''}">
                    <div class="alert-item-header">
                        <span class="alert-device-name">Dispositivo: ${esc(a.dispositivo_numero_serie)}</span>
                        <span class="alert-badge-pill ${crit ? 'critico' : 'aviso'}">${crit ? 'Crítico' : 'Aviso'}</span>
                    </div>
                    <div class="alert-msg-text"><strong>${esc(a.parametro)}:</strong> ${esc(a.mensagem)}</div>
                    <div class="alert-item-footer">
                        <span>${esc(hora)}</span>
                        <button class="btn-read-alert" data-alert-id="${esc(a.id)}">Marcar Lido</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    async function markAlertAsRead(alertId) {
        try {
            const res = await fetch(`${global.API_BASE}${config.basePath}/${encodeURIComponent(alertId)}/lido`, {
                method: 'PUT',
                headers: getHeaders()
            });
            if (res.ok) fetchAlertsFromApi();
        } catch (e) {
            console.error('Erro ao marcar alerta como lido:', e);
        }
    }

    async function markAllAlertsAsRead() {
        try {
            const res = await fetch(`${global.API_BASE}${config.basePath}/limpar-todos`, {
                method: 'PUT',
                headers: getHeaders()
            });
            if (res.ok) fetchAlertsFromApi();
        } catch (e) {
            console.error('Erro ao limpar todos os alertas:', e);
        }
    }

    // Exporta no escopo global para compatibilidade com HTML onclick
    global.fetchAlertsFromApi = fetchAlertsFromApi;
    global.updateHeaderAlertBadge = updateHeaderAlertBadge;
    global.toggleHeaderAlerts = toggleHeaderAlerts;
    global.filterAlerts = filterAlerts;
    global.renderAlertsList = renderAlertsList;
    global.markAlertAsRead = markAlertAsRead;
    global.markAllAlertsAsRead = markAllAlertsAsRead;

    global.SensoriumAlerts = {
        configure,
        fetchAlertsFromApi,
        updateHeaderAlertBadge,
        toggleHeaderAlerts,
        filterAlerts,
        renderAlertsList,
        markAlertAsRead,
        markAllAlertsAsRead
    };
})(window);
