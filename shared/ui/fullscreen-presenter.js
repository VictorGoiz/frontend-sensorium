/**
 * ============================================================================
 * SENSIMONITOR - CONTROLADOR DE TELA CHEIA, CARROSSEL & MANÔMETRO (UI)
 * ============================================================================
 * Unifica a lógica de apresentação em Modo Tela Cheia (TV / Monitor), incluindo:
 * - Alternância Fullscreen API (padrão e webkit)
 * - Carrossel com rotação automática (8s) e navegação por setas/teclado (Espaço, Setas)
 * - Indicadores (dots) e seletor rápido de estação
 * - Manômetro semicircular (Doughnut 180° Chart.js) reutilizável
 *
 * As páginas NÃO devem redefinir as funções expostas aqui (toggleFullscreen,
 * navigateFullscreenCarousel, renderFsDots...): basta chamar
 * SensoriumFullscreen.bindFullscreenCarousel({...}) com o que é próprio da tela.
 */
(function (global) {
    'use strict';

    const gauges = new Map(); // um manômetro por canvas (ex.: temperatura e umidade no LFG60)

    const esc = (v) => (typeof global.escapeHtml === 'function' ? global.escapeHtml(v) : String(v ?? ''));

    const ICON_ENTER = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>';
    const ICON_EXIT = '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>';
    const ICON_PAUSE = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
    const ICON_PLAY = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';

    /**
     * Alterna o modo Tela Cheia do navegador
     */
    function toggleFullscreen() {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen();
            } else if (document.documentElement.webkitRequestFullscreen) {
                document.documentElement.webkitRequestFullscreen();
            }
        } else if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }

    /**
     * Renderiza ou atualiza o manômetro semicircular (Chart.js Doughnut 180°)
     */
    function updateFsGaugeChart(value, min, max, fillColor, canvasId = 'fsGaugePressureCanvas', borderRadius = 4) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || typeof global.Chart === 'undefined') return null;

        const val = value !== null && value !== undefined && !isNaN(value) ? Number(value) : min;
        const clamped = Math.max(min, Math.min(max, val));
        const data = [clamped - min, max - clamped];

        const existing = gauges.get(canvasId);
        if (existing) {
            try {
                if (existing.canvas === canvas) {
                    existing.data.datasets[0].data = data;
                    existing.data.datasets[0].backgroundColor = [fillColor, '#e2e8f0'];
                    existing.update('none');
                    return existing;
                }
                existing.destroy();
            } catch (e) {
                /* instância inválida: recria abaixo */
            }
            gauges.delete(canvasId);
        }

        try {
            const chart = new global.Chart(canvas.getContext('2d'), {
                type: 'doughnut',
                data: {
                    datasets: [{
                        data,
                        backgroundColor: [fillColor, '#e2e8f0'],
                        borderWidth: 0,
                        circumference: 180,
                        rotation: 270,
                        borderRadius: [borderRadius, borderRadius]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '74%',
                    animation: false,
                    plugins: { tooltip: { enabled: false }, legend: { display: false } }
                }
            });
            gauges.set(canvasId, chart);
            return chart;
        } catch (err) {
            console.warn('[Fullscreen Gauge] Erro ao criar manômetro:', err);
            return null;
        }
    }

    /**
     * Liga o carrossel de tela cheia de uma página de dispositivos e expõe no escopo
     * global as funções usadas pelos onclick do HTML.
     *
     * @param {Object} config
     * @param {Function} config.getDevices Retorna o array atual de dispositivos
     * @param {Function} [config.render] Desenha o dispositivo do índice (padrão: window.renderFullscreenStation)
     * @param {string} [config.standardSelectId] Select fora da tela cheia usado como posição inicial
     * @param {Function} [config.formatOptionLabel] Texto de cada <option> do select da tela cheia
     * @param {string} [config.emptyOptionLabel='Nenhum dispositivo']
     * @param {string} [config.dotTitlePrefix='Ir para item']
     * @param {string} [config.dotsContainerId='fsDotsContainer']
     * @param {{enter: string, exit: string}} [config.labels] Texto do botão Tela Cheia
     * @param {boolean} [config.swapIcon=true] Troca o ícone do botão ao entrar/sair
     * @param {boolean} [config.autoStart=true] Inicia a rotação automática ao entrar
     * @param {string} [config.playingClass='playing'] Classe do botão de rotação enquanto gira
     * @param {boolean} [config.restartAutoplayOnNavigate=false] Navegação manual reinicia a contagem
     * @param {Function} [config.onEmpty] Chamado ao entrar na tela cheia sem dispositivos
     * @param {Function} [config.onFullscreenToggle] Chamado ao entrar/sair da tela cheia
     */
    function bindFullscreenCarousel(config) {
        let activeIndex = 0;
        let autoplayInterval = null;
        const autoplayDuration = config.autoplayDuration || 8000;
        const labels = config.labels || { enter: 'Tela Cheia', exit: 'Sair da Tela Cheia' };
        const playingClass = config.playingClass || 'playing';
        const dotsContainerId = config.dotsContainerId || 'fsDotsContainer';
        let keyboardAttached = false;

        const devices = () => config.getDevices() || [];
        const render = (i) => {
            const fn = config.render || global.renderFullscreenStation;
            if (typeof fn === 'function') fn(i);
        };

        function getActiveIndex() {
            return activeIndex;
        }

        /** Normaliza e guarda o índice ativo (as páginas chamam no início do seu render). */
        function setActiveIndex(idx) {
            const total = devices().length;
            if (total === 0) {
                activeIndex = 0;
                return 0;
            }
            if (idx < 0) idx = total - 1;
            if (idx >= total) idx = 0;
            activeIndex = idx;
            return activeIndex;
        }

        function goTo(idx) {
            if (devices().length === 0) return;
            render(setActiveIndex(idx));
        }

        function populateFsDeviceSelect() {
            const select = document.getElementById('fsDeviceSelect');
            if (!select) return;
            const list = devices();
            if (list.length === 0) {
                select.innerHTML = `<option value="">${esc(config.emptyOptionLabel || 'Nenhum dispositivo')}</option>`;
                return;
            }
            select.innerHTML = list.map((d, idx) => {
                const label = typeof config.formatOptionLabel === 'function'
                    ? config.formatOptionLabel(d, idx, list.length)
                    : `${d.numero_serie} (${idx + 1}/${list.length})`;
                return `<option value="${esc(d.numero_serie)}">${esc(label)}</option>`;
            }).join('');
            const atual = list[activeIndex];
            if (atual) select.value = atual.numero_serie;
        }

        function renderFsDots() {
            const container = document.getElementById(dotsContainerId);
            if (!container) return;
            const prefix = config.dotTitlePrefix || 'Ir para item';
            container.innerHTML = devices().map((_, idx) => `
                <div class="fs-dot ${idx === activeIndex ? 'active' : ''}" data-fs-index="${idx}" title="${esc(prefix)} ${idx + 1}"></div>
            `).join('');
            if (!container.dataset.fsBound) {
                container.dataset.fsBound = '1';
                container.addEventListener('click', (ev) => {
                    const dot = ev.target.closest('[data-fs-index]');
                    if (dot) goTo(Number(dot.dataset.fsIndex));
                });
            }
        }

        function startFsAutoplay() {
            stopFsAutoplay();
            const btn = document.getElementById('fsAutoplayBtn');
            const txt = document.getElementById('fsAutoplayText');
            const icon = document.getElementById('fsAutoplayIcon');
            if (btn) btn.classList.add(playingClass);
            if (txt) txt.innerText = 'Pausar (8s)';
            if (icon) icon.innerHTML = ICON_PAUSE;
            autoplayInterval = setInterval(() => navigateFullscreenCarousel(1, true), autoplayDuration);
        }

        function stopFsAutoplay() {
            if (autoplayInterval) {
                clearInterval(autoplayInterval);
                autoplayInterval = null;
            }
            const btn = document.getElementById('fsAutoplayBtn');
            const txt = document.getElementById('fsAutoplayText');
            const icon = document.getElementById('fsAutoplayIcon');
            if (btn) btn.classList.remove(playingClass);
            if (txt) txt.innerText = 'Auto (8s)';
            if (icon) icon.innerHTML = ICON_PLAY;
        }

        function toggleFullscreenAutoplay() {
            if (autoplayInterval) stopFsAutoplay();
            else startFsAutoplay();
        }

        function navigateFullscreenCarousel(direction, fromAutoplay = false) {
            if (devices().length === 0) return;
            goTo(activeIndex + direction);
            if (!fromAutoplay && config.restartAutoplayOnNavigate && autoplayInterval) startFsAutoplay();
        }

        function onFsDeviceSelectChange(selectedSerial) {
            if (!selectedSerial) return;
            const idx = devices().findIndex((d) => d.numero_serie === selectedSerial);
            if (idx >= 0) goTo(idx);
        }

        function handleFullscreenKeydown(e) {
            if (!document.body.classList.contains('fullscreen-active')) return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                navigateFullscreenCarousel(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                navigateFullscreenCarousel(1);
            } else if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                toggleFullscreenAutoplay();
            }
        }

        function setupFullscreenPresentation() {
            if (!keyboardAttached) {
                document.addEventListener('keydown', handleFullscreenKeydown);
                keyboardAttached = true;
            }
            const list = devices();
            if (config.standardSelectId) {
                const standardSelect = document.getElementById(config.standardSelectId);
                if (standardSelect && standardSelect.value && list.length > 0) {
                    const foundIdx = list.findIndex((d) => d.numero_serie === standardSelect.value);
                    if (foundIdx >= 0) activeIndex = foundIdx;
                }
            }
            populateFsDeviceSelect();
            if (list.length === 0) {
                if (typeof config.onEmpty === 'function') config.onEmpty();
            } else {
                render(setActiveIndex(activeIndex));
            }
            if (config.autoStart !== false) startFsAutoplay();
        }

        function handleFullscreenChange() {
            const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
            const textEl = document.getElementById('fullscreenText');
            const iconEl = document.getElementById('fullscreenIcon');
            document.body.classList.toggle('fullscreen-active', isFs);
            if (textEl) textEl.innerText = isFs ? labels.exit : labels.enter;
            if (iconEl && config.swapIcon !== false) iconEl.innerHTML = isFs ? ICON_EXIT : ICON_ENTER;

            if (isFs) setupFullscreenPresentation();
            else stopFsAutoplay();

            if (typeof config.onFullscreenToggle === 'function') config.onFullscreenToggle(isFs);
        }

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

        // Expõe os handlers globais usados pelos onclick do HTML
        global.toggleFullscreen = toggleFullscreen;
        global.onFsDeviceSelectChange = onFsDeviceSelectChange;
        global.navigateFullscreenCarousel = (d) => navigateFullscreenCarousel(d);
        global.toggleFullscreenAutoplay = toggleFullscreenAutoplay;
        global.updateFsGaugeChart = updateFsGaugeChart;

        return {
            getActiveIndex,
            setActiveIndex,
            goTo,
            isActive: () => document.body.classList.contains('fullscreen-active'),
            populateFsDeviceSelect,
            renderFsDots,
            startFsAutoplay,
            stopFsAutoplay,
            handleFullscreenChange,
            navigateFullscreenCarousel
        };
    }

    global.toggleFullscreen = toggleFullscreen;
    global.updateFsGaugeChart = updateFsGaugeChart;
    global.SensoriumFullscreen = {
        toggleFullscreen,
        updateFsGaugeChart,
        bindFullscreenCarousel
    };
})(window);
