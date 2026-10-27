/**
 * ============================================================================
 * SENSIMONITOR - CONTROLADOR DE BADGE "AO VIVO" E RELÓGIO CORPORATIVO (UI)
 * ============================================================================
 * Gerencia o estado visual (verde pulsante vs cinza aguardando) com watchdog
 * automático de 15 segundos e relógio em tempo real para painéis corporativos.
 */
(function (global) {
    'use strict';

    /**
     * Cria um controlador de Badge de Transmissão Ao Vivo
     * @param {Object} options
     * @param {string} [options.badgeId='livePresentationBadge']
     * @param {string} [options.textId='liveBadgeText']
     * @param {string} [options.liveLabel='TRANSMISSÃO AO VIVO']
     * @param {string} [options.waitingLabel='AGUARDANDO DADOS']
     * @param {string} [options.fsBadgeId] Ex: 'fsLiveBadge'
     * @param {string} [options.fsTextId] Ex: 'cwLiveStatusText' ou 'sfLiveStatusText'
     * @param {string} [options.fsLiveLabel='AO VIVO']
     * @param {string} [options.fsWaitingLabel='AGUARDANDO']
     * @param {number} [options.timeoutMs=15000]
     */
    function createLiveBadgeController(options = {}) {
        const badgeId = options.badgeId || 'livePresentationBadge';
        const textId = options.textId || 'liveBadgeText';
        const liveLabel = options.liveLabel !== undefined ? options.liveLabel : 'TRANSMISSÃO AO VIVO';
        const waitingLabel = options.waitingLabel !== undefined ? options.waitingLabel : 'AGUARDANDO DADOS';
        const fsBadgeId = options.fsBadgeId || null;
        const fsTextId = options.fsTextId || null;
        const fsLiveLabel = options.fsLiveLabel || 'AO VIVO';
        const fsWaitingLabel = options.fsWaitingLabel || 'AGUARDANDO';
        const timeoutMs = options.timeoutMs || 15000;

        let watchdogTimer = null;

        function setState(isLive) {
            const badge = document.getElementById(badgeId) || document.getElementById('sensorLiveBadge') || document.getElementById('releLiveBadge');
            const badgeText = textId ? document.getElementById(textId) : null;

            if (badge) {
                if (isLive) {
                    badge.classList.add('active');
                    if (badgeText && liveLabel) badgeText.innerText = liveLabel;
                    if (watchdogTimer) clearTimeout(watchdogTimer);
                    watchdogTimer = setTimeout(() => {
                        setState(false);
                    }, timeoutMs);
                } else {
                    badge.classList.remove('active');
                    if (badgeText && waitingLabel) badgeText.innerText = waitingLabel;
                }
            }

            if (fsBadgeId) {
                const fsBadge = document.getElementById(fsBadgeId);
                const fsText = fsTextId ? document.getElementById(fsTextId) : null;
                if (fsBadge) {
                    if (isLive) {
                        fsBadge.classList.add('active');
                        if (fsText) fsText.innerText = fsLiveLabel;
                    } else {
                        fsBadge.classList.remove('active');
                        if (fsText) fsText.innerText = fsWaitingLabel;
                    }
                }
            }
        }

        return { setState };
    }

    /**
     * Inicializa relógio corporativo em tempo real (HH:MM:SS e Data por extenso)
     * @param {string} clockElementId Ex: 'cwLiveClock' ou 'sfLiveClock'
     * @param {string} dateElementId Ex: 'cwLiveDate' ou 'sfLiveDate'
     */
    function startCorporateClock(clockElementId, dateElementId) {
        const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

        function update() {
            const timeEl = document.getElementById(clockElementId);
            const dateEl = document.getElementById(dateElementId);
            if (!timeEl && !dateEl) return;

            const now = new Date();
            if (timeEl) {
                const hh = String(now.getHours()).padStart(2, '0');
                const mm = String(now.getMinutes()).padStart(2, '0');
                const ss = String(now.getSeconds()).padStart(2, '0');
                timeEl.innerText = `${hh}:${mm}:${ss}`;
            }
            if (dateEl) {
                dateEl.innerText = `${diasSemana[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]}`;
            }
        }

        update();
        return setInterval(update, 1000);
    }

    global.SensoriumLiveBadge = {
        createLiveBadgeController,
        startCorporateClock
    };
})(window);
