/**
 * ============================================================================
 * SENSIMONITOR - PRESSURIZAÇÃO DE ÁGUA SMART FIT
 * Lógica da Página e Apresentação de Tela Cheia Corporativa
 * ============================================================================
 */

let currentPressurizacoes = [];
let chartInstance = null;
let currentPeriod = 'all';
let sensorLiveWatchdog = null;
let liveClockInterval = null;

// Fullscreen Presentation & Carousel State
let fullscreenActiveIndex = 0;
let fsAutoplayInterval = null;
const fsAutoplayDuration = 8000;
let fsGaugeChartInstance = null;
let fsPressurizacaoChartInstance = null;
let fsKeyboardListenerAttached = false;

// Estado da Modal de Registros
let registrosModalCurrentPage = 1;
const REGISTROS_MODAL_LIMIT = 20;
let registrosModalTotalPages = 1;
let registrosModalFiltros = {
    dispositivo: 'todos',
    dataInicio: '',
    dataFim: ''
};

function getAuthHeaders() {
    const token = localStorage.getItem('sensorium_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function setLiveBadgeState(isLive) {
    const badge = document.getElementById('livePresentationBadge');
    const badgeText = document.getElementById('liveBadgeText');
    const fsLiveBadge = document.getElementById('fsLiveBadge');
    const sfLiveStatusText = document.getElementById('sfLiveStatusText');

    if (badge) {
        if (isLive) {
            badge.classList.add('active');
            if (badgeText) badgeText.innerText = 'AO VIVO';
            if (sensorLiveWatchdog) clearTimeout(sensorLiveWatchdog);
            sensorLiveWatchdog = setTimeout(() => setLiveBadgeState(false), 15000);
        } else {
            badge.classList.remove('active');
            if (badgeText) badgeText.innerText = 'AGUARDANDO DADOS';
        }
    }

    if (fsLiveBadge) {
        if (isLive) {
            fsLiveBadge.classList.add('active');
            if (sfLiveStatusText) sfLiveStatusText.innerText = 'AO VIVO';
        } else {
            fsLiveBadge.classList.remove('active');
            if (sfLiveStatusText) sfLiveStatusText.innerText = 'AGUARDANDO';
        }
    }
}

// ============================================================================
// INICIALIZAÇÃO DA PÁGINA
// ============================================================================
document.addEventListener('DOMContentLoaded', function() {
    const userStr = localStorage.getItem('sensorium_user');
    if (userStr) {
        try {
            const user = JSON.parse(userStr);
            if (user.perfil === 'apresentacao') {
                document.querySelectorAll('.sidebar nav > a.nav-item').forEach(el => {
                    el.style.display = 'none';
                });
            }
        } catch (e) {}
    }

    startLiveClock();
    loadPressurizacaoDashboard();

    // WebSocket / Socket.IO
    if (typeof io !== 'undefined') {
        const socket = io(API_BASE, {
            auth: { token: localStorage.getItem('sensorium_token') },
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            transports: ['websocket', 'polling']
        });

        socket.on('pressurizacao_update', (data) => {
            handleLivePressurizacaoUpdate(data);
        });

        socket.on('sensor_reading', (data) => {
            if (data?.numeroSerie) {
                handleLivePressurizacaoUpdate(data);
            }
        });

        socket.on('dashboard_update', (data) => {
            if (data?.type === 'pressurizacao_update' || data?.type === 'sensor_data') {
                handleLivePressurizacaoUpdate(data.data || data);
            }
        });

        socket.on('disconnect', () => {
            setLiveBadgeState(false);
        });

        setInterval(loadPressurizacaoDashboard, 20000);
    } else {
        setInterval(loadPressurizacaoDashboard, 10000);
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
});

// ============================================================================
// RELÓGIO CORPORATIVO EM TEMPO REAL
// ============================================================================
function startLiveClock() {
    updateClockDisplay();
    if (liveClockInterval) clearInterval(liveClockInterval);
    liveClockInterval = setInterval(updateClockDisplay, 1000);
}

function updateClockDisplay() {
    const timeEl = document.getElementById('sfLiveClock');
    const dateEl = document.getElementById('sfLiveDate');
    if (!timeEl && !dateEl) return;

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');
    if (timeEl) timeEl.innerText = `${hours}:${mins}:${secs}`;

    if (dateEl) {
        const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        const diaSemana = diasSemana[now.getDay()];
        const dia = now.getDate();
        const mes = meses[now.getMonth()];
        dateEl.innerText = `${diaSemana}, ${dia} de ${mes}`;
    }
}

// ============================================================================
// CARREGAMENTO DE DADOS (API)
// ============================================================================
async function loadPressurizacaoDashboard() {
    try {
        const res = await fetch(`${API_BASE}/api/pressurizacao`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('Erro ao buscar estações de pressurização');
        const result = await res.json();
        
        currentPressurizacoes = result.data || result || [];
        
        populatePressurizacaoSelect(currentPressurizacoes);
        renderExecutiveCards(currentPressurizacoes);
        renderPressurizacaoGrid(currentPressurizacoes);
        
        const hasLive = currentPressurizacoes.some(d => d.ultima_leitura && d.ultima_leitura.sensor1 !== null);
        setLiveBadgeState(hasLive);

        // Atualiza tela cheia se estiver ativa
        if (document.body.classList.contains('fullscreen-active')) {
            renderFullscreenStation(fullscreenActiveIndex);
        }

        // Gráfico principal fora de tela cheia
        const select = document.getElementById('pressurizacaoSelect');
        const activeSerial = select ? select.value : (currentPressurizacoes[0]?.numero_serie || null);
        if (activeSerial) {
            loadPressurizacaoChart(activeSerial, false);
        }
    } catch (err) {
        console.warn('[Smart Fit] Erro ao carregar painel:', err.message);
    }
}

function handleLivePressurizacaoUpdate(update) {
    if (!update || !update.numeroSerie) return;

    setLiveBadgeState(true);
    const station = currentPressurizacoes.find(d => d.numero_serie === update.numeroSerie);
    if (!station) {
        loadPressurizacaoDashboard();
        return;
    }

    station.ultima_leitura = {
        ...(station.ultima_leitura || {}),
        sensor1: update.sensor1 !== undefined ? update.sensor1 : station.ultima_leitura?.sensor1,
        rele1_estado: update.rele1_estado !== undefined ? update.rele1_estado : station.ultima_leitura?.rele1_estado,
        rele2_estado: update.rele2_estado !== undefined ? update.rele2_estado : station.ultima_leitura?.rele2_estado,
        rele1_on: update.rele1_on !== undefined ? update.rele1_on : station.ultima_leitura?.rele1_on,
        rele1_off: update.rele1_off !== undefined ? update.rele1_off : station.ultima_leitura?.rele1_off,
        rele2_on: update.rele2_on !== undefined ? update.rele2_on : station.ultima_leitura?.rele2_on,
        rele2_off: update.rele2_off !== undefined ? update.rele2_off : station.ultima_leitura?.rele2_off,
        rele1_acionamentos: update.rele1_acionamentos !== undefined ? update.rele1_acionamentos : station.ultima_leitura?.rele1_acionamentos,
        rele2_acionamentos: update.rele2_acionamentos !== undefined ? update.rele2_acionamentos : station.ultima_leitura?.rele2_acionamentos,
        timestamp: update.timestamp || new Date().toISOString()
    };

    renderExecutiveCards(currentPressurizacoes);

    if (document.body.classList.contains('fullscreen-active')) {
        const activeDev = currentPressurizacoes[fullscreenActiveIndex];
        if (activeDev && activeDev.numero_serie === update.numeroSerie) {
            renderFullscreenStation(fullscreenActiveIndex);
        }
    }
}

function populatePressurizacaoSelect(devices) {
    const select = document.getElementById('pressurizacaoSelect');
    if (!select) return;

    if (!devices || devices.length === 0) {
        select.innerHTML = '<option value="">Nenhuma central Smart Fit</option>';
        return;
    }

    const currentVal = select.value;
    select.innerHTML = devices.map(d => `
        <option value="${d.numero_serie}">${d.numero_serie} - ${d.nome || 'Booster Vestiários'}</option>
    `).join('');

    if (devices.some(d => d.numero_serie === currentVal)) {
        select.value = currentVal;
    } else {
        select.value = devices[0].numero_serie;
    }
}

function onSelectPressurizacaoChange() {
    const select = document.getElementById('pressurizacaoSelect');
    if (!select || !select.value) return;
    renderExecutiveCards(currentPressurizacoes);
    loadPressurizacaoChart(select.value, true);
}

function getPressureColor(val, onVal, offVal) {
    if (val === null || val === undefined || isNaN(val)) return '#94a3b8';
    const num = Number(val);
    const minIdeal = (onVal !== null && onVal !== undefined) ? Number(onVal) : 35;
    const maxIdeal = (offVal !== null && offVal !== undefined) ? Number(offVal) : 50;

    if (num < 20) return '#dc2626'; // Subpressão crítica
    if (num < minIdeal) return '#f59e0b'; // Acionando recomposição
    if (num <= maxIdeal) return '#10b981'; // Pressurização ideal
    if (num > 60) return '#ea580c'; // Sobrepressão
    return '#10b981';
}

function renderExecutiveCards(devices) {
    if (!devices || devices.length === 0) return;

    const select = document.getElementById('pressurizacaoSelect');
    const targetSerial = select ? select.value : devices[0].numero_serie;
    const activeDev = devices.find(d => d.numero_serie === targetSerial) || devices[0];
    const u = activeDev.ultima_leitura || {};

    const pValEl = document.getElementById('execPressureVal');
    const pDevEl = document.getElementById('execDeviceSerial');
    const pressure = (u.sensor1 !== null && u.sensor1 !== undefined) ? Number(u.sensor1) : null;
    
    if (pValEl) {
        pValEl.innerText = pressure !== null ? pressure.toFixed(1) : '--';
        pValEl.style.color = getPressureColor(pressure, u.rele1_on, u.rele1_off);
    }
    if (pDevEl) pDevEl.innerText = activeDev.numero_serie;

    // Bomba 1
    const r1StatusEl = document.getElementById('execR1Status');
    const r1OnEl = document.getElementById('execR1On');
    const r1OffEl = document.getElementById('execR1Off');
    const r1AcEl = document.getElementById('execR1Ac');
    const isR1On = pressure !== null && (u.rele1_estado === 1 || pressure <= (u.rele1_on || 35));

    if (r1StatusEl) {
        r1StatusEl.innerText = isR1On ? 'OPERANDO' : 'STANDBY';
        r1StatusEl.style.color = isR1On ? '#0284c7' : '#64748b';
    }
    if (r1OnEl) r1OnEl.innerText = `${u.rele1_on || 35} psi`;
    if (r1OffEl) r1OffEl.innerText = `${u.rele1_off || 50} psi`;
    if (r1AcEl) r1AcEl.innerText = u.rele1_acionamentos || 0;

    // Bomba 2
    const r2StatusEl = document.getElementById('execR2Status');
    const r2OnEl = document.getElementById('execR2On');
    const r2OffEl = document.getElementById('execR2Off');
    const r2AcEl = document.getElementById('execR2Ac');
    const isR2On = pressure !== null && (u.rele2_estado === 1 || pressure <= (u.rele2_on || 32));

    if (r2StatusEl) {
        r2StatusEl.innerText = isR2On ? 'OPERANDO' : 'STANDBY';
        r2StatusEl.style.color = isR2On ? '#ea580c' : '#64748b';
    }
    if (r2OnEl) r2OnEl.innerText = `${u.rele2_on || 32} psi`;
    if (r2OffEl) r2OffEl.innerText = `${u.rele2_off || 50} psi`;
    if (r2AcEl) r2AcEl.innerText = u.rele2_acionamentos || 0;

    // Status Geral
    const totalEl = document.getElementById('execTotalPressurizacao');
    const sysStatusEl = document.getElementById('execSystemStatus');
    if (totalEl) totalEl.innerText = devices.length;
    if (sysStatusEl) {
        const hasCrit = devices.some(d => d.status === 'Crítico');
        const hasWarn = devices.some(d => d.status === 'Atenção');
        if (hasCrit) {
            sysStatusEl.innerText = 'Crítico';
            sysStatusEl.className = 'val-pill red';
        } else if (hasWarn) {
            sysStatusEl.innerText = 'Atenção';
            sysStatusEl.className = 'val-pill yellow';
        } else {
            sysStatusEl.innerText = 'Pressurizado';
            sysStatusEl.className = 'val-pill green';
        }
    }
}

function renderPressurizacaoGrid(devices) {
    const grid = document.getElementById('pressurizacaoGrid');
    if (!grid) return;

    if (devices.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-muted);">Nenhuma estação cadastrada.</div>';
        return;
    }

    grid.innerHTML = devices.map(d => {
        const u = d.ultima_leitura || {};
        const p = u.sensor1 !== null && u.sensor1 !== undefined ? Number(u.sensor1) : null;
        const pDisplay = p !== null ? `${p.toFixed(1)} psi` : '--';
        const pColor = getPressureColor(p, u.rele1_on, u.rele1_off);

        return `
            <div class="pressurizacao-card" onclick="selectDeviceFromGrid('${d.numero_serie}')">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                    <div>
                        <h4 style="font-size: 14px; font-weight: 700; color: #0f172a; margin: 0;">${d.nome || 'Booster Hidráulico'}</h4>
                        <span style="font-size: 11px; color: #64748b;">${d.numero_serie}</span>
                    </div>
                    <span class="val-pill green">${d.status || 'Operacional'}</span>
                </div>
                <div style="display: flex; align-items: baseline; gap: 4px; margin: 8px 0;">
                    <span style="font-size: 28px; font-weight: 800; color: ${pColor};">${pDisplay}</span>
                </div>
                <div style="font-size: 11px; color: #64748b; border-top: 1px solid #f1f5f9; padding-top: 8px; display: flex; justify-content: space-between;">
                    <span>Bomba 1: <strong>${u.rele1_estado ? 'ON' : 'OFF'}</strong></span>
                    <span>Bomba 2: <strong>${u.rele2_estado ? 'ON' : 'OFF'}</strong></span>
                </div>
            </div>
        `;
    }).join('');
}

function selectDeviceFromGrid(serial) {
    const select = document.getElementById('pressurizacaoSelect');
    if (select) {
        select.value = serial;
        onSelectPressurizacaoChange();
    }
}

// ============================================================================
// GRÁFICO INTERATIVO FORA DE TELA CHEIA
// ============================================================================
async function loadPressurizacaoChart(serial, force) {
    const canvas = document.getElementById('pressurizacaoChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const targetSerial = serial || document.getElementById('pressurizacaoSelect')?.value;
    if (!targetSerial) return;

    const periodSelect = document.getElementById('pressurizacaoPeriodSelect');
    const period = periodSelect ? periodSelect.value : 'all';

    try {
        const res = await fetch(`${API_BASE}/api/pressurizacao/${targetSerial}/leituras?periodo=${period}`, {
            headers: getAuthHeaders()
        });
        const result = res.ok ? await res.json() : [];
        const leituras = result.data || result || [];

        renderChartData(canvas, leituras, targetSerial);
    } catch (e) {
        console.warn('[Smart Fit] Erro ao carregar gráfico:', e.message);
    }
}

function renderChartData(canvas, leituras, serial) {
    const dev = currentPressurizacoes.find(d => d.numero_serie === serial) || {};
    const u = dev.ultima_leitura || {};
    const r1_on = u.rele1_on || 35.0;
    const r1_off = u.rele1_off || 50.0;
    const r2_on = u.rele2_on || 32.0;

    const labels = [];
    const pressureData = [];
    const r1OnData = [];
    const r1OffData = [];
    const r2OnData = [];

    if (Array.isArray(leituras) && leituras.length > 0) {
        leituras.forEach(l => {
            labels.push(new Date(l.timestamp || l.data_hora).toLocaleTimeString('pt-BR'));
            pressureData.push(l.sensor1 ?? l.pressao);
            r1OnData.push(l.rele1_on ?? r1_on);
            r1OffData.push(l.rele1_off ?? r1_off);
            r2OnData.push(l.rele2_on ?? r2_on);
        });
    } else {
        const now = Date.now();
        for (let i = 15; i >= 0; i--) {
            labels.push(new Date(now - i * 3000).toLocaleTimeString('pt-BR'));
            pressureData.push(Number(u.sensor1 || 42.0));
            r1OnData.push(r1_on);
            r1OffData.push(r1_off);
            r2OnData.push(r2_on);
        }
    }

    if (chartInstance) {
        chartInstance.destroy();
    }

    const ctx = canvas.getContext('2d');
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Pressão da Rede (psi)',
                    data: pressureData,
                    borderColor: '#0284c7',
                    backgroundColor: 'rgba(2, 132, 199, 0.08)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35
                },
                {
                    label: 'Partida Bomba 1 (ON)',
                    data: r1OnData,
                    borderColor: '#06b6d4',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    pointRadius: 0
                },
                {
                    label: 'Partida Bomba 2 (ON)',
                    data: r2OnData,
                    borderColor: '#f97316',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    pointRadius: 0
                },
                {
                    label: 'Pressão de Corte (OFF)',
                    data: r1OffData,
                    borderColor: '#10b981',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { min: 0, max: 70, grid: { color: '#f1f5f9' } },
                x: { grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// ============================================================================
// 6. MODO TELA CHEIA CORPORATIVO (SMART FIT)
// ============================================================================
function toggleFullscreen() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
            document.documentElement.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
}

function handleFullscreenChange() {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const fsText = document.getElementById('fullscreenText');
    if (fsText) {
        fsText.innerText = isFs ? 'Sair da Tela Cheia' : 'Tela Cheia Smart Fit';
    }

    document.body.classList.toggle('fullscreen-active', isFs);

    if (isFs) {
        setupFullscreenPresentation();
    } else {
        stopFsAutoplay();
    }
}

function setupFullscreenPresentation() {
    if (!fsKeyboardListenerAttached) {
        document.addEventListener('keydown', handleFullscreenKeydown);
        fsKeyboardListenerAttached = true;
    }

    populateFsDeviceSelect();

    const standardSelect = document.getElementById('pressurizacaoSelect');
    if (standardSelect && standardSelect.value && currentPressurizacoes && currentPressurizacoes.length > 0) {
        const foundIdx = currentPressurizacoes.findIndex(d => d.numero_serie === standardSelect.value);
        if (foundIdx >= 0) fullscreenActiveIndex = foundIdx;
    }

    renderFullscreenStation(fullscreenActiveIndex);
    startFsAutoplay();
}

function populateFsDeviceSelect() {
    const select = document.getElementById('fsDeviceSelect');
    if (!select) return;

    if (!currentPressurizacoes || currentPressurizacoes.length === 0) {
        select.innerHTML = '<option value="">Unidade Smart Fit (Sem dados)</option>';
        return;
    }

    select.innerHTML = currentPressurizacoes.map((d, idx) => `
        <option value="${d.numero_serie}">Smart Fit — ${d.nome || 'Booster Principal'} (${idx + 1}/${currentPressurizacoes.length})</option>
    `).join('');
}

function onFsDeviceSelectChange(selectedSerial) {
    if (!selectedSerial || !currentPressurizacoes) return;
    const idx = currentPressurizacoes.findIndex(d => d.numero_serie === selectedSerial);
    if (idx >= 0) {
        renderFullscreenStation(idx);
    }
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

function navigateFullscreenCarousel(direction) {
    if (!currentPressurizacoes || currentPressurizacoes.length === 0) return;
    fullscreenActiveIndex += direction;
    if (fullscreenActiveIndex < 0) fullscreenActiveIndex = currentPressurizacoes.length - 1;
    if (fullscreenActiveIndex >= currentPressurizacoes.length) fullscreenActiveIndex = 0;

    renderFullscreenStation(fullscreenActiveIndex);
}

function toggleFullscreenAutoplay() {
    if (fsAutoplayInterval) {
        stopFsAutoplay();
    } else {
        startFsAutoplay();
    }
}

function startFsAutoplay() {
    stopFsAutoplay();
    const btn = document.getElementById('fsAutoplayBtn');
    const txt = document.getElementById('fsAutoplayText');
    const icon = document.getElementById('fsAutoplayIcon');

    if (btn) btn.classList.add('playing');
    if (txt) txt.innerText = 'Pausar (8s)';
    if (icon) icon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';

    fsAutoplayInterval = setInterval(() => {
        navigateFullscreenCarousel(1);
    }, fsAutoplayDuration);
}

function stopFsAutoplay() {
    if (fsAutoplayInterval) {
        clearInterval(fsAutoplayInterval);
        fsAutoplayInterval = null;
    }
    const btn = document.getElementById('fsAutoplayBtn');
    const txt = document.getElementById('fsAutoplayText');
    const icon = document.getElementById('fsAutoplayIcon');

    if (btn) btn.classList.remove('playing');
    if (txt) txt.innerText = 'Auto (8s)';
    if (icon) icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
}

function renderFsDots() {
    const container = document.getElementById('fsDotsContainer');
    if (!container || !currentPressurizacoes) return;

    container.innerHTML = currentPressurizacoes.map((_, idx) => `
        <div class="fs-dot ${idx === fullscreenActiveIndex ? 'active' : ''}" onclick="renderFullscreenStation(${idx})" title="Ir para estação ${idx + 1}"></div>
    `).join('');
}

/**
 * Renderiza a estação ativa no Modo Tela Cheia Smart Fit
 */
function renderFullscreenStation(index) {
    if (!currentPressurizacoes || currentPressurizacoes.length === 0) return;

    if (index < 0) index = currentPressurizacoes.length - 1;
    if (index >= currentPressurizacoes.length) index = 0;
    fullscreenActiveIndex = index;

    const dev = currentPressurizacoes[index];
    const u = dev.ultima_leitura || {};

    // 1. Identificação da Estação
    const titleEl = document.getElementById('fsDeviceTitle');
    if (titleEl) titleEl.innerText = `${dev.nome || 'Booster Duchas & Vestiários'} (${dev.numero_serie})`;

    const statusPill = document.getElementById('fsStatusPill');
    const statusText = document.getElementById('fsStatusText');
    const pressure = (u.sensor1 !== null && u.sensor1 !== undefined) ? Number(u.sensor1) : null;
    const isCrit = dev.status === 'Crítico' || (pressure !== null && pressure < 20);
    const isWarn = dev.status === 'Atenção' || (pressure !== null && pressure > 60);
    const stClass = isCrit ? 'critico' : (isWarn ? 'atencao' : 'operacional');
    const stLabel = isCrit ? 'Subpressão' : (isWarn ? 'Sobrepressão' : 'Operacional');

    if (statusPill) statusPill.className = `sf-status-pill ${stClass}`;
    if (statusText) statusText.innerText = stLabel;

    const timeEl = document.getElementById('fsLastReadingTime');
    if (timeEl) {
        const timeStr = u.timestamp ? new Date(u.timestamp).toLocaleTimeString('pt-BR') : '--:--:--';
        timeEl.innerText = `Última telemetria: ${timeStr}`;
    }

    // 2. Setpoints reais configurados para a estação
    const r1_on = u.rele1_on !== null && u.rele1_on !== undefined ? Number(u.rele1_on) : 35.0;
    const r1_off = u.rele1_off !== null && u.rele1_off !== undefined ? Number(u.rele1_off) : 50.0;
    const r2_on = u.rele2_on !== null && u.rele2_on !== undefined ? Number(u.rele2_on) : 32.0;
    const r2_off = u.rele2_off !== null && u.rele2_off !== undefined ? Number(u.rele2_off) : 50.0;

    const isR1On = pressure !== null && (u.rele1_estado === 1 || pressure <= r1_on);
    const isR2On = pressure !== null && (u.rele2_estado === 1 || pressure <= r2_on);

    // 3. Atualização do Card de Informação no Banner (Lado Esquerdo de 45%)
    const sfBadge = document.getElementById('sfPressureStatusBadge');
    const sfVal = document.getElementById('sfPressureStatusValue');
    const sfDesc = document.getElementById('sfPressureStatusDesc');
    const heroPressure = document.getElementById('sfHeroPressureVal');
    const heroB1 = document.getElementById('sfHeroBomba1Val');
    const heroB2 = document.getElementById('sfHeroBomba2Val');

    if (heroPressure) heroPressure.innerText = pressure !== null ? `${pressure.toFixed(1)} psi` : '-- psi';
    if (heroB1) heroB1.innerText = isR1On ? 'Operando' : 'Standby';
    if (heroB2) heroB2.innerText = isR2On ? 'Operando' : 'Standby';

    if (sfBadge && sfVal && sfDesc) {
        if (isCrit) {
            sfVal.innerText = 'Subpressão';
            sfBadge.className = 'sf-status-badge critico';
            sfDesc.innerText = 'Pressão abaixo do limite de segurança. Recomenda-se verificar a entrada de água da concessionária e barrilete.';
        } else if (isWarn) {
            sfVal.innerText = 'Sobrepressão';
            sfBadge.className = 'sf-status-badge atencao';
            sfDesc.innerText = 'Pressão elevada na rede. Sistema operando sob monitoramento preventivo de alívio.';
        } else {
            sfVal.innerText = 'Boa / Pressurizada';
            sfBadge.className = 'sf-status-badge ideal';
            sfDesc.innerText = 'Rede hidráulica em pressão ideal. Abastecimento contínuo e equilibrado nas duchas, vestiários e bebedouros para a melhor experiência dos alunos.';
        }
    }

    // Destaques de Bem-Estar no lado direito do banner
    const wellDuchas = document.getElementById('sfWellnessDuchas');
    const wellBooster = document.getElementById('sfWellnessBooster');
    const wellSeg = document.getElementById('sfWellnessSeguranca');

    if (wellDuchas) {
        if (pressure !== null) {
            wellDuchas.innerText = `${pressure.toFixed(1)} psi (Fluxo Pleno)`;
        } else {
            wellDuchas.innerText = 'Pressão Estável';
        }
    }

    if (wellBooster) {
        if (isR1On && isR2On) {
            wellBooster.innerText = 'Booster 1 + 2 Operando (Pico)';
        } else if (isR1On) {
            wellBooster.innerText = 'Bomba 1 Recompondo Pressão';
        } else {
            wellBooster.innerText = 'Bombas em Standby (Rede Cheia)';
        }
    }

    if (wellSeg) {
        wellSeg.innerText = !isCrit && !isWarn ? '100% Conforme' : 'Atenção Operacional';
    }

    // 4. Manômetro de Pressão (Área Inferior de 55%)
    const pColor = getPressureColor(pressure, r1_on, r1_off);
    const tempValEl = document.getElementById('fsTempVal');
    if (tempValEl) {
        tempValEl.innerText = pressure !== null ? pressure.toFixed(1) : '--';
        tempValEl.style.color = pColor;
    }

    const pEvalEl = document.getElementById('fsPressureEval');
    if (pEvalEl) {
        if (isCrit) {
            pEvalEl.className = 'sf-status-chip critico';
            pEvalEl.innerText = 'Subpressão';
        } else if (isWarn) {
            pEvalEl.className = 'sf-status-chip aviso';
            pEvalEl.innerText = 'Sobrepressão';
        } else {
            pEvalEl.className = 'sf-status-chip ideal';
            pEvalEl.innerText = 'Estável / Ideal';
        }
    }

    // ATUALIZAÇÃO DINÂMICA DA LEGENDA DA ESCALA DO MANÔMETRO A PARTIR DOS LIMITES DO BANCO
    const scaleMidEl = document.querySelector('#fsPressureGaugeCard .fs-gauge-scale-mid') || document.querySelector('.fs-gauge-scale-mid');
    if (scaleMidEl) {
        scaleMidEl.innerText = `Faixa Ideal: ${r1_on.toFixed(1)} a ${r1_off.toFixed(1)} psi`;
    }

    updateFsGaugeChart(pressure, 0, 80, pColor);

    // 5. Cards das Bombas Booster 1 e 2
    const r1Badge = document.getElementById('fsR1StateBadge');
    const r1Text = document.getElementById('fsR1StatusText');
    const r1OnVal = document.getElementById('fsR1OnVal');
    const r1OffVal = document.getElementById('fsR1OffVal');
    const r1AcVal = document.getElementById('fsR1AcVal');

    if (r1Badge) {
        r1Badge.className = `sf-relay-pill ${isR1On ? 'on' : 'off'}`;
        r1Badge.innerText = isR1On ? 'OPERANDO' : 'STANDBY';
    }
    if (r1Text) {
        r1Text.innerText = isR1On ? 'OPERANDO' : 'STANDBY';
        r1Text.style.color = isR1On ? '#0284c7' : '#64748b';
    }
    if (r1OnVal) r1OnVal.innerText = `${r1_on.toFixed(1)} psi`;
    if (r1OffVal) r1OffVal.innerText = `${r1_off.toFixed(1)} psi`;
    if (r1AcVal) r1AcVal.innerText = u.rele1_acionamentos || 0;

    const r2Badge = document.getElementById('fsR2StateBadge');
    const r2Text = document.getElementById('fsR2StatusText');
    const r2OnVal = document.getElementById('fsR2OnVal');
    const r2OffVal = document.getElementById('fsR2OffVal');
    const r2AcVal = document.getElementById('fsR2AcVal');

    if (r2Badge) {
        r2Badge.className = `sf-relay-pill ${isR2On ? 'on' : 'off'}`;
        r2Badge.innerText = isR2On ? 'OPERANDO' : 'STANDBY';
    }
    if (r2Text) {
        r2Text.innerText = isR2On ? 'OPERANDO' : 'STANDBY';
        r2Text.style.color = isR2On ? '#ea580c' : '#64748b';
    }
    if (r2OnVal) r2OnVal.innerText = `${r2_on.toFixed(1)} psi`;
    if (r2OffVal) r2OffVal.innerText = `${r2_off.toFixed(1)} psi`;
    if (r2AcVal) r2AcVal.innerText = u.rele2_acionamentos || 0;

    // 6. Diagnóstico do Barrilete
    const diagChip = document.getElementById('fsDiagChip');
    const diagStatus = document.getElementById('fsDiagStatusText');
    const diagDemand = document.getElementById('fsDiagDemand');

    if (diagChip && diagStatus) {
        if (isR1On && isR2On) {
            diagChip.className = 'sf-norm-pill';
            diagChip.style.background = '#fffbeb';
            diagChip.style.color = '#d97706';
            diagChip.style.borderColor = '#fde68a';
            diagChip.innerText = 'PICO DE CONSUMO';
            diagStatus.innerText = 'DUPLO BOOSTER';
            if (diagDemand) diagDemand.innerText = 'Alta Demanda (Bomba 1 + 2)';
        } else if (isR1On) {
            diagChip.className = 'sf-norm-pill';
            diagChip.style.background = '#ecfeff';
            diagChip.style.color = '#0891b2';
            diagChip.style.borderColor = '#a5f3fc';
            diagChip.innerText = 'RECOMPOSIÇÃO';
            diagStatus.innerText = 'PRESSURIZANDO';
            if (diagDemand) diagDemand.innerText = 'Demanda Ativa (Bomba 1)';
        } else {
            diagChip.className = 'sf-norm-pill';
            diagChip.style.background = '#ecfdf5';
            diagChip.style.color = '#059669';
            diagChip.style.borderColor = '#a7f3d0';
            diagChip.innerText = '100% OPERACIONAL';
            diagStatus.innerText = 'PRESSURIZADO';
            if (diagDemand) diagDemand.innerText = 'Em Standby (Rede Cheia)';
        }
    }

    // 7. Gráfico Fullscreen
    renderFullscreenChart(dev);

    // 8. Sincroniza Select e Dots
    renderFsDots();
    const select = document.getElementById('fsDeviceSelect');
    if (select && select.value !== dev.numero_serie) {
        select.value = dev.numero_serie;
    }
    const counterEl = document.getElementById('fsDeviceCounterText');
    if (counterEl) {
        counterEl.innerText = `Estação ${fullscreenActiveIndex + 1} de ${currentPressurizacoes.length}`;
    }
}

function updateFsGaugeChart(value, min, max, fillColor) {
    const canvas = document.getElementById('fsGaugePressureCanvas');
    if (!canvas || typeof Chart === 'undefined') return;

    const val = (value !== null && value !== undefined && !isNaN(value)) ? Number(value) : min;
    const clamped = Math.max(min, Math.min(max, val));
    const progress = clamped - min;
    const remaining = max - clamped;

    if (fsGaugeChartInstance) {
        try {
            if (fsGaugeChartInstance.canvas === canvas) {
                fsGaugeChartInstance.data.datasets[0].data = [progress, remaining];
                fsGaugeChartInstance.data.datasets[0].backgroundColor = [fillColor, '#e2e8f0'];
                fsGaugeChartInstance.update('none');
                return;
            } else {
                fsGaugeChartInstance.destroy();
                fsGaugeChartInstance = null;
            }
        } catch (e) {
            fsGaugeChartInstance = null;
        }
    }

    try {
        const ctx = canvas.getContext('2d');
        fsGaugeChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [progress, remaining],
                    backgroundColor: [fillColor, '#e2e8f0'],
                    borderWidth: 0,
                    circumference: 180,
                    rotation: 270,
                    borderRadius: [6, 6]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '74%',
                animation: false,
                plugins: {
                    tooltip: { enabled: false },
                    legend: { display: false }
                }
            }
        });
    } catch (err) {
        console.warn('Erro ao criar manômetro fullscreen:', err);
    }
}

function renderFullscreenChart(dev) {
    const canvas = document.getElementById('fsPressurizacaoChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const u = dev.ultima_leitura || {};
    const r1_on = u.rele1_on || 35.0;
    const r1_off = u.rele1_off || 50.0;
    const r2_on = u.rele2_on || 32.0;

    const labels = [];
    const pressureData = [];
    const r1OnData = [];
    const r1OffData = [];
    const r2OnData = [];

    const now = Date.now();
    const pointsCount = 25;
    const intervalMs = 3000;

    let baseP = Number(u.sensor1 || 42.0);
    for (let i = pointsCount - 1; i >= 0; i--) {
        const t = new Date(now - i * intervalMs);
        labels.push(t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        const offset = Math.sin(i * 0.45) * 4.5 + (Math.random() * 1.2);
        const p = Math.max(25, Math.min(55, baseP + offset));
        pressureData.push(Number(p.toFixed(1)));
        r1OnData.push(r1_on);
        r1OffData.push(r1_off);
        r2OnData.push(r2_on);
    }

    if (fsPressurizacaoChartInstance) {
        try {
            if (fsPressurizacaoChartInstance.canvas === canvas) {
                fsPressurizacaoChartInstance.data.labels = labels;
                fsPressurizacaoChartInstance.data.datasets[0].data = pressureData;
                fsPressurizacaoChartInstance.data.datasets[1].data = r1OnData;
                fsPressurizacaoChartInstance.data.datasets[2].data = r2OnData;
                fsPressurizacaoChartInstance.data.datasets[3].data = r1OffData;
                fsPressurizacaoChartInstance.update('none');
                return;
            } else {
                fsPressurizacaoChartInstance.destroy();
                fsPressurizacaoChartInstance = null;
            }
        } catch (e) {
            fsPressurizacaoChartInstance = null;
        }
    }

    try {
        const ctx = canvas.getContext('2d');
        fsPressurizacaoChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Pressão da Rede (psi)',
                        data: pressureData,
                        borderColor: '#0284c7',
                        backgroundColor: 'rgba(2, 132, 199, 0.08)',
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.35,
                        pointRadius: 2
                    },
                    {
                        label: 'Partida Bomba 1 (ON)',
                        data: r1OnData,
                        borderColor: '#06b6d4',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        pointRadius: 0
                    },
                    {
                        label: 'Partida Bomba 2 (ON)',
                        data: r2OnData,
                        borderColor: '#f97316',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        pointRadius: 0
                    },
                    {
                        label: 'Pressão de Corte (OFF)',
                        data: r1OffData,
                        borderColor: '#10b981',
                        borderWidth: 1.5,
                        borderDash: [4, 4],
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        min: 15,
                        max: 65,
                        grid: { color: '#f1f5f9' },
                        ticks: { font: { size: 10 } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 9 }, maxRotation: 0 }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    } catch (chartErr) {
        console.warn('Erro ao criar gráfico fullscreen:', chartErr);
    }
}

// ============================================================================
// MODAL DE REGISTROS (HISTÓRICO E EXPORTAÇÃO CSV)
// ============================================================================
function openRegistrosModal() {
    const modal = document.getElementById('registrosModal');
    if (!modal) return;

    popularSelectFiltroDispositivoModal();
    definirDataPadraoFiltroModal();
    registrosModalCurrentPage = 1;
    carregarRegistrosModal();
    modal.classList.add('active');
}

function closeRegistrosModal() {
    const modal = document.getElementById('registrosModal');
    if (modal) modal.classList.remove('active');
}

function handleRegistrosModalBackdrop(e) {
    if (e.target && e.target.id === 'registrosModal') {
        closeRegistrosModal();
    }
}

function popularSelectFiltroDispositivoModal() {
    const select = document.getElementById('filterModalDispositivo');
    if (!select) return;

    let html = '<option value="todos">Todas as Estações</option>';
    if (Array.isArray(currentPressurizacoes)) {
        currentPressurizacoes.forEach(d => {
            html += `<option value="${d.numero_serie}">${d.numero_serie} - ${d.nome || 'Booster'}</option>`;
        });
    }
    select.innerHTML = html;
}

function definirDataPadraoFiltroModal() {
    const inputInicio = document.getElementById('filterModalDataInicio');
    const inputFim = document.getElementById('filterModalDataFim');

    if (inputInicio && !inputInicio.value) {
        const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        inputInicio.value = formatarDataParaInputLocal(seteDiasAtras);
    }
    if (inputFim && !inputFim.value) {
        inputFim.value = formatarDataParaInputLocal(new Date());
    }
}

function formatarDataParaInputLocal(data) {
    const d = new Date(data);
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    const horas = String(d.getHours()).padStart(2, '0');
    const minutos = String(d.getMinutes()).padStart(2, '0');
    return `${ano}-${mes}-${dia}T${horas}:${minutos}`;
}

function aplicarAtalhoData(preset) {
    const inputInicio = document.getElementById('filterModalDataInicio');
    const inputFim = document.getElementById('filterModalDataFim');
    if (!inputInicio || !inputFim) return;

    const agora = new Date();
    inputFim.value = formatarDataParaInputLocal(agora);

    if (preset === 'hoje') {
        const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0);
        inputInicio.value = formatarDataParaInputLocal(inicioHoje);
    } else if (preset === '7dias') {
        const seteDias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        inputInicio.value = formatarDataParaInputLocal(seteDias);
    } else if (preset === '30dias') {
        const trintaDias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        inputInicio.value = formatarDataParaInputLocal(trintaDias);
    }

    filtrarRegistrosModal();
}

function filtrarRegistrosModal() {
    registrosModalCurrentPage = 1;
    carregarRegistrosModal();
}

function limparFiltrosRegistrosModal() {
    const select = document.getElementById('filterModalDispositivo');
    const inputInicio = document.getElementById('filterModalDataInicio');
    const inputFim = document.getElementById('filterModalDataFim');

    if (select) select.value = 'todos';
    if (inputInicio) inputInicio.value = '';
    if (inputFim) inputFim.value = '';

    definirDataPadraoFiltroModal();
    filtrarRegistrosModal();
}

async function carregarRegistrosModal() {
    const tbody = document.getElementById('registrosTableBody');
    const countInfo = document.getElementById('registrosTotalCount');
    const pageIndicator = document.getElementById('registrosPageIndicator');
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');

    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="10" class="table-state-message">Consultando banco de dados...</td></tr>';
    }

    const select = document.getElementById('filterModalDispositivo');
    const inputInicio = document.getElementById('filterModalDataInicio');
    const inputFim = document.getElementById('filterModalDataFim');

    const dispositivo = select ? select.value : 'todos';
    const dataInicio = inputInicio ? inputInicio.value : '';
    const dataFim = inputFim ? inputFim.value : '';

    const params = new URLSearchParams({
        page: registrosModalCurrentPage,
        limit: REGISTROS_MODAL_LIMIT,
        dispositivo,
        dataInicio,
        dataFim
    });

    try {
        const res = await fetch(`${API_BASE}/api/pressurizacao/registros?${params.toString()}`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('Falha na resposta do servidor');

        const resultado = await res.json();
        const itens = resultado.data || [];
        const paginacao = resultado.paginacao || { total: itens.length, totalPages: 1 };

        registrosModalTotalPages = paginacao.totalPages || 1;

        if (countInfo) countInfo.innerText = `${paginacao.total || 0} registro(s) encontrado(s)`;
        if (pageIndicator) pageIndicator.innerText = `Página ${registrosModalCurrentPage} de ${registrosModalTotalPages}`;
        if (btnPrev) btnPrev.disabled = registrosModalCurrentPage <= 1;
        if (btnNext) btnNext.disabled = registrosModalCurrentPage >= registrosModalTotalPages;

        if (!itens || itens.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="table-state-message">Nenhum registro encontrado no intervalo selecionado.</td></tr>';
            return;
        }

        tbody.innerHTML = itens.map(r => {
            const timeStr = r.timestamp || r.data_hora ? new Date(r.timestamp || r.data_hora).toLocaleString('pt-BR') : '--';
            const pressao = r.sensor1 !== null && r.sensor1 !== undefined ? `${Number(r.sensor1).toFixed(1)} psi` : '--';
            return `
                <tr>
                    <td><strong>${r.dispositivo_numero_serie || r.numero_serie || '--'}</strong></td>
                    <td>${r.dispositivo_nome || r.nome || 'Booster Smart Fit'}</td>
                    <td>${timeStr}</td>
                    <td style="font-weight: 700; color: #0284c7;">${pressao}</td>
                    <td>${r.rele1_on !== null ? `${Number(r.rele1_on).toFixed(1)} psi` : '--'}</td>
                    <td>${r.rele1_off !== null ? `${Number(r.rele1_off).toFixed(1)} psi` : '--'}</td>
                    <td>${r.rele1_acionamentos ?? '--'}</td>
                    <td>${r.rele2_on !== null ? `${Number(r.rele2_on).toFixed(1)} psi` : '--'}</td>
                    <td>${r.rele2_off !== null ? `${Number(r.rele2_off).toFixed(1)} psi` : '--'}</td>
                    <td>${r.rele2_acionamentos ?? '--'}</td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="table-state-message error">Erro ao carregar registros.</td></tr>';
    }
}

function mudarPaginaRegistros(delta) {
    const novaPagina = registrosModalCurrentPage + delta;
    if (novaPagina >= 1 && novaPagina <= registrosModalTotalPages) {
        registrosModalCurrentPage = novaPagina;
        carregarRegistrosModal();
    }
}

function exportarRegistrosCSV() {
    const select = document.getElementById('filterModalDispositivo');
    const inputInicio = document.getElementById('filterModalDataInicio');
    const inputFim = document.getElementById('filterModalDataFim');

    const dispositivo = select ? select.value : 'todos';
    const dataInicio = inputInicio ? inputInicio.value : '';
    const dataFim = inputFim ? inputFim.value : '';

    const params = new URLSearchParams({ dispositivo, dataInicio, dataFim });
    window.open(`${API_BASE}/api/pressurizacao/exportar-csv?${params.toString()}`, '_blank');
}

function abrirConfirmacaoExclusao() {
    const modal = document.getElementById('confirmDeleteModal');
    if (!modal) return;

    const select = document.getElementById('filterModalDispositivo');
    const inputInicio = document.getElementById('filterModalDataInicio');
    const inputFim = document.getElementById('filterModalDataFim');

    const devEl = document.getElementById('confirmDeleteDispositivo');
    const iniEl = document.getElementById('confirmDeleteDataInicio');
    const fimEl = document.getElementById('confirmDeleteDataFim');

    if (devEl) devEl.innerText = select ? select.options[select.selectedIndex]?.text : 'Todas';
    if (iniEl) iniEl.innerText = inputInicio?.value ? new Date(inputInicio.value).toLocaleString('pt-BR') : 'Não definido';
    if (fimEl) fimEl.innerText = inputFim?.value ? new Date(inputFim.value).toLocaleString('pt-BR') : 'Não definido';

    modal.classList.add('active');
}

function fecharConfirmacaoExclusao() {
    const modal = document.getElementById('confirmDeleteModal');
    if (modal) modal.classList.remove('active');
}

async function executarExclusaoRegistros() {
    const select = document.getElementById('filterModalDispositivo');
    const inputInicio = document.getElementById('filterModalDataInicio');
    const inputFim = document.getElementById('filterModalDataFim');

    const dispositivo = select ? select.value : 'todos';
    const dataInicio = inputInicio ? inputInicio.value : '';
    const dataFim = inputFim ? inputFim.value : '';

    try {
        const res = await fetch(`${API_BASE}/api/pressurizacao/registros`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({ dispositivo, dataInicio, dataFim })
        });
        if (res.ok) {
            alert('Registros apagados com sucesso!');
            fecharConfirmacaoExclusao();
            carregarRegistrosModal();
        } else {
            alert('Erro ao apagar registros.');
        }
    } catch (e) {
        alert('Erro de conexão ao apagar registros.');
    }
}
