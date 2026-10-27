let currentPressurizacoes = [];
let selectedDeviceSerial = '';
let socketInstance = null;
let isUpdatingDashboard = false;
let lastDevicesSignature = '';
let lastProcessedReadingSignature = '';
let pressurizacaoChartInstance = null;
let fluidTelemetry = null;

// Fullscreen Presentation & Carousel State
let fsGaugeChartInstance = null;
let fsChartSerial = '';
let fsChartLoadedAt = 0;
const fsChartInstanceReady = () => !!fsPressurizacaoChartInstance;
let fsPressurizacaoChartInstance = null;

// Estado do Modal de Registros
let registrosCurrentPage = 1;
let registrosTotalPages = 1;
const registrosPageLimit = 20;
let isFetchingRegistros = false;
let mockRegistrosHistory = [];

// Controlador compartilhado da badge de transmissão (../../shared/ui/live-badge.js)
const liveBadgeCtrl = window.SensoriumLiveBadge
    ? window.SensoriumLiveBadge.createLiveBadgeController()
    : null;

// Tela cheia / carrossel: mecânica em ../../shared/ui/fullscreen-presenter.js
const fsCarousel = window.SensoriumFullscreen.bindFullscreenCarousel({
    getDevices: () => currentPressurizacoes,
    render: (index) => renderFullscreenStation(index),
    standardSelectId: 'pressurizacaoSelect',
    formatOptionLabel: (d, i, n) => `${d.numero_serie} - ${d.nome || 'Estação'} (${i + 1}/${n})`,
    emptyOptionLabel: 'Nenhuma estação',
    dotTitlePrefix: 'Ir para estação',
    labels: { enter: 'Tela Cheia', exit: 'Sair Tela Cheia' },
    swapIcon: false,
});

function setLiveBadgeState(isLive) {
    if (liveBadgeCtrl) liveBadgeCtrl.setState(isLive);
}

document.addEventListener('DOMContentLoaded', function() {
    initRealtimeConnection();
    loadPressurizacaoData();

    // Sincronização periódica inteligente da telemetria a cada 1.5s
    if (window.SensoriumRealtime) {
        window.SensoriumRealtime.startSmartPolling(() => loadPressurizacaoData(true), 1500);
    } else {
        setInterval(() => loadPressurizacaoData(true), 1500);
    }

    // Simulação só no modo demonstração (?demo=1)
    if (window.SENSORIUM_DEMO) setInterval(simulateLivePressurizacaoStep, 1000);

});

/**
 * Inicializa conexão Socket.IO para streaming em tempo real.
 * Só o evento deste tipo de dispositivo; leituras mais antigas que a exibida
 * (ou repetidas, já que o backend envia pressurizacao_reading e dashboard_update juntos) são ignoradas.
 */
function initRealtimeConnection() {
    if (!window.SensoriumRealtime) return;
    const receber = (data) => {
        if (!data || !data.numeroSerie) return;
        const dev = currentPressurizacoes.find(d => d.numero_serie === data.numeroSerie);
        if (!window.SensoriumRealtime.isNewerReading(data, dev && dev.ultima_leitura)) return;
        handleLivePressurizacaoReading(data);
    };
    socketInstance = window.SensoriumRealtime.createRealtimeSocket({
        logPrefix: 'Pressurização',
        events: {
            pressurizacao_reading: receber,
            dashboard_update: (pacote) => {
                if (pacote?.type === 'pressurizacao_data' && pacote.data) receber(pacote.data);
            }
        },
        onDisconnect: () => setLiveBadgeState(false)
    });
}

/**
 * Carrega dados das estações de pressurização via API
 */
async function loadPressurizacaoData(silent = false) {
    if (isUpdatingDashboard) return;
    isUpdatingDashboard = true;

    try {
        let loadedData = null;

        try {
            const res = await fetch(`${API_BASE}/api/pressurizacao`, {
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const result = await res.json();
                if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                    loadedData = result.data;
                }
            }
        } catch (apiErr) {
            if (!silent) console.warn('[Pressurização] API ainda não disponível. Utilizando dados simulados de frontend:', apiErr.message);
        }

        if (loadedData !== null && loadedData.length > 0) {
            currentPressurizacoes = window.SensoriumRealtime ? window.SensoriumRealtime.mergeKeepingNewest(currentPressurizacoes, loadedData) : loadedData;
        } else if (window.SENSORIUM_DEMO && currentPressurizacoes.length === 0) {
            currentPressurizacoes = JSON.parse(JSON.stringify(SIMULATED_PRESSURIZACAO_DEVICES));
        }

        populatePressurizacaoSelect(currentPressurizacoes);
        renderPressurizacaoGrid(currentPressurizacoes);
        updateExecutiveSummary(currentPressurizacoes);

        if (document.body.classList.contains('fullscreen-active')) {
            renderFullscreenStation(fsCarousel.getActiveIndex());
        }

        const hasData = currentPressurizacoes.length > 0 && currentPressurizacoes.some(d => d.ultima_leitura && d.ultima_leitura.sensor1 !== null && d.ultima_leitura.sensor1 !== undefined);
        if (hasData) {
            setLiveBadgeState(true);
        } else if (currentPressurizacoes.length === 0) {
            setLiveBadgeState(false);
        }

        if (selectedDeviceSerial && !fluidTelemetry) {
            loadPressurizacaoChart(selectedDeviceSerial, false);
        } else if (selectedDeviceSerial) {
            const dev = currentPressurizacoes.find(d => d.numero_serie === selectedDeviceSerial);
            if (dev && dev.ultima_leitura) {
                const u = dev.ultima_leitura;
                const curSig = `${selectedDeviceSerial}_${u.timestamp}_${u.sensor1}_${u.rele1_on}_${u.rele1_off}`;
                if (lastProcessedReadingSignature !== curSig) {
                    lastProcessedReadingSignature = curSig;
                    handleLivePressurizacaoReading({
                        numeroSerie: dev.numero_serie,
                        ...dev.ultima_leitura
                    });
                }
            }
        }
    } catch (err) {
        if (!silent) console.warn('[Pressurização] Erro ao sincronizar:', err.message);
        if (currentPressurizacoes.length === 0) {
            setLiveBadgeState(false);
        }
    } finally {
        isUpdatingDashboard = false;
    }
}

/**
 * Simulação contínua do ciclo hidropneumático das bombas de pressurização
 * (Dados e motor simulados em ../../shared/mocks/pressurizacao.mock.js)
 */
function simulateLivePressurizacaoStep() {
    if (!currentPressurizacoes || currentPressurizacoes.length === 0) return;
    const hasSimulated = typeof stepPressurizacaoSimulation === 'function'
        ? stepPressurizacaoSimulation(currentPressurizacoes)
        : false;

    if (hasSimulated) {
        setLiveBadgeState(true);
        renderPressurizacaoGrid(currentPressurizacoes);
        updateExecutiveSummary(currentPressurizacoes);

        if (document.body.classList.contains('fullscreen-active')) {
            renderFullscreenStation(fsCarousel.getActiveIndex());
        }

        if (selectedDeviceSerial) {
            const dev = currentPressurizacoes.find(d => d.numero_serie === selectedDeviceSerial);
            if (dev && dev.ultima_leitura) {
                handleLivePressurizacaoReading({
                    numeroSerie: dev.numero_serie,
                    ...dev.ultima_leitura
                });
            }
        }
    }
}

/**
 * Processa a telemetria ao vivo com latência zero
 */
function handleLivePressurizacaoReading(reading) {
    if (!reading || !reading.numeroSerie) return;
    const { numeroSerie, sensor1, rele1_on, rele1_off, rele1_acionamentos, rele2_on, rele2_off, rele2_acionamentos, timestamp } = reading;

    lastProcessedReadingSignature = `${numeroSerie}_${timestamp}_${sensor1}_${rele1_on}_${rele1_off}`;
    setLiveBadgeState(true);

    let dev = currentPressurizacoes.find(d => d.numero_serie === numeroSerie);
    if (dev) {
        dev.ultima_leitura = {
            sensor1,
            rele1_on,
            rele1_off,
            rele1_acionamentos,
            rele2_on,
            rele2_off,
            rele2_acionamentos,
            timestamp: timestamp || new Date()
        };
    }

    if (selectedDeviceSerial === numeroSerie) {
        updateExecutiveCardValues(reading);
        if (fluidTelemetry) {
            fluidTelemetry.pushReading(reading);
        }
    }

    if (document.body.classList.contains('fullscreen-active')) {
        const activeDev = currentPressurizacoes[fsCarousel.getActiveIndex()];
        if (activeDev && activeDev.numero_serie === numeroSerie) {
            renderFullscreenStation(fsCarousel.getActiveIndex());
        }
    }
}

/**
 * Preenche o select de estações no header
 */
function populatePressurizacaoSelect(devices) {
    const select = document.getElementById('pressurizacaoSelect');
    if (!select) return;

    const currentSelected = select.value;
    select.innerHTML = '';

    if (!devices || devices.length === 0) {
        select.innerHTML = '<option value="">Nenhuma estação encontrada</option>';
        selectedDeviceSerial = '';
        return;
    }

    devices.forEach((dev, idx) => {
        const opt = document.createElement('option');
        opt.value = dev.numero_serie;
        opt.innerText = `${dev.numero_serie} - ${dev.nome || 'Estação de Pressurização'}`;
        if (idx === 0 && !currentSelected) {
            opt.selected = true;
            selectedDeviceSerial = dev.numero_serie;
        } else if (dev.numero_serie === currentSelected) {
            opt.selected = true;
            selectedDeviceSerial = dev.numero_serie;
        }
        select.appendChild(opt);
    });

    if (!selectedDeviceSerial && devices.length > 0) {
        selectedDeviceSerial = devices[0].numero_serie;
    }
}

function onSelectPressurizacaoChange() {
    const select = document.getElementById('pressurizacaoSelect');
    if (!select) return;
    selectedDeviceSerial = select.value;
    loadPressurizacaoChart(selectedDeviceSerial, false);
    updateExecutiveSummary(currentPressurizacoes);
}

/**
 * Atualiza os 4 cards executivos no topo
 */
function updateExecutiveSummary(devices) {
    const totalEl = document.getElementById('execTotalPressurizacao');
    if (totalEl) totalEl.innerText = devices ? devices.length : 0;

    const dev = devices.find(d => d.numero_serie === selectedDeviceSerial);
    if (dev && dev.ultima_leitura) {
        updateExecutiveCardValues({ numeroSerie: dev.numero_serie, ...dev.ultima_leitura });
    }
}

function updateExecutiveCardValues(reading) {
    const pValEl = document.getElementById('execPressureVal');
    const dSerialEl = document.getElementById('execDeviceSerial');
    const r1StatusEl = document.getElementById('execR1Status');
    const r1OnEl = document.getElementById('execR1On');
    const r1OffEl = document.getElementById('execR1Off');
    const r1AcEl = document.getElementById('execR1Ac');
    const r2StatusEl = document.getElementById('execR2Status');
    const r2OnEl = document.getElementById('execR2On');
    const r2OffEl = document.getElementById('execR2Off');
    const r2AcEl = document.getElementById('execR2Ac');
    const sysStatusEl = document.getElementById('execSystemStatus');

    const pressure = (reading.sensor1 !== null && reading.sensor1 !== undefined) ? Number(reading.sensor1) : null;
    if (pValEl) {
        pValEl.innerText = pressure !== null ? pressure.toFixed(1) : '--';
        pValEl.style.color = getPressureColor(pressure, reading.rele1_on, reading.rele1_off);
    }

    if (dSerialEl) dSerialEl.innerText = reading.numeroSerie || '--';

    const r1_on = reading.rele1_on !== null && reading.rele1_on !== undefined ? Number(reading.rele1_on) : 35;
    const r1_off = reading.rele1_off !== null && reading.rele1_off !== undefined ? Number(reading.rele1_off) : 50;
    const r2_on = reading.rele2_on !== null && reading.rele2_on !== undefined ? Number(reading.rele2_on) : 32;
    const r2_off = reading.rele2_off !== null && reading.rele2_off !== undefined ? Number(reading.rele2_off) : 50;

    const isR1On = pressure !== null && (reading.rele1_estado === 1 || pressure <= r1_on);
    const isR2On = pressure !== null && (reading.rele2_estado === 1 || pressure <= r2_on);

    if (r1StatusEl) {
        r1StatusEl.innerText = isR1On ? 'ATIVO (BOMBA 1 ON)' : 'DESLIGADO (OFF)';
        r1StatusEl.style.color = isR1On ? '#10b981' : '#64748b';
    }
    if (r1OnEl) r1OnEl.innerText = Number(r1_on).toFixed(1);
    if (r1OffEl) r1OffEl.innerText = Number(r1_off).toFixed(1);
    if (r1AcEl) r1AcEl.innerText = reading.rele1_acionamentos ?? '--';

    if (r2StatusEl) {
        r2StatusEl.innerText = isR2On ? 'ATIVO (BOMBA 2 ON)' : 'DESLIGADO (OFF)';
        r2StatusEl.style.color = isR2On ? '#10b981' : '#64748b';
    }
    if (r2OnEl) r2OnEl.innerText = Number(r2_on).toFixed(1);
    if (r2OffEl) r2OffEl.innerText = Number(r2_off).toFixed(1);
    if (r2AcEl) r2AcEl.innerText = reading.rele2_acionamentos ?? '--';

    if (sysStatusEl) {
        if (pressure === null) {
            sysStatusEl.className = 'val-pill gray';
            sysStatusEl.innerText = 'Sem Dados';
        } else if (pressure < 20.0) {
            sysStatusEl.className = 'val-pill red';
            sysStatusEl.innerText = 'Crítico';
        } else if (pressure > 65.0) {
            sysStatusEl.className = 'val-pill yellow';
            sysStatusEl.innerText = 'Atenção';
        } else {
            sysStatusEl.className = 'val-pill green';
            sysStatusEl.innerText = 'Normal / Ideal';
        }
    }
}

function getPressureColor(val, minOn, maxOff) {
    if (val === null || val === undefined) return '#0f172a';
    const v = Number(val);
    const on = minOn ? Number(minOn) : 35;
    const off = maxOff ? Number(maxOff) : 50;

    if (v < 20) return '#ef4444';
    if (v <= on) return '#0891b2';
    if (v >= off && v <= 60) return '#10b981';
    if (v > 60) return '#ea580c';
    return '#0284c7';
}

/**
 * Renderiza o Grid de Cards de Estações de Pressurização
 */
const activeGauges = {};

function renderPressurizacaoGrid(devices) {
    const grid = document.getElementById('pressurizacaoGrid');
    if (!grid) return;

    if (!devices || devices.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-muted);">Nenhuma estação de pressurização monitorada.</div>';
        return;
    }

    const summaryEl = document.getElementById('pressurizacaoListSummary');
    if (summaryEl) summaryEl.innerText = `${devices.length} estação(ões) conectadas`;

    const existingCards = grid.querySelectorAll('.pressurizacao-card');
    const hasMatchingDom = existingCards.length === devices.length && devices.every(d => document.getElementById(`press-card-${d.numero_serie}`));

    if (hasMatchingDom) {
        devices.forEach(dev => {
            updateSinglePressurizacaoCardDom(dev);
        });
        return;
    }

    Object.keys(activeGauges).forEach(key => {
        if (activeGauges[key]) {
            try { activeGauges[key].destroy(); } catch (e) {}
            delete activeGauges[key];
        }
    });

    grid.innerHTML = devices.map(dev => {
        const u = dev.ultima_leitura || {};
        const pressure = (u.sensor1 !== null && u.sensor1 !== undefined) ? Number(u.sensor1) : null;
        const pressureDisplay = pressure !== null ? `${pressure.toFixed(2)} psi` : '-- psi';
        const isSel = dev.numero_serie === selectedDeviceSerial;

        const r1_on = u.rele1_on !== null && u.rele1_on !== undefined ? Number(u.rele1_on).toFixed(1) : '35.0';
        const r1_off = u.rele1_off !== null && u.rele1_off !== undefined ? Number(u.rele1_off).toFixed(1) : '50.0';

        const isCrit = dev.status === 'Crítico' || (pressure !== null && pressure < 20);
        const isWarn = dev.status === 'Atenção' || (pressure !== null && pressure > 60);
        const dotClass = isCrit ? 'red' : (isWarn ? 'yellow' : 'green');
        const timeStr = u.timestamp ? new Date(u.timestamp).toLocaleTimeString('pt-BR') : 'Sem leitura';

        return `
            <div class="pressurizacao-card ${isSel ? 'selected' : ''}" id="press-card-${escapeHtml(dev.numero_serie)}" data-serie="${escapeHtml(dev.numero_serie)}" onclick="selectStationForChart(this.dataset.serie)">
                <div class="pressurizacao-card-header">
                    <span class="pressurizacao-card-title">Estação #${escapeHtml(dev.numero_serie)}</span>
                    <span class="status-dot-fine ${dotClass}" title="${escapeHtml(dev.status || 'Operacional')}"></span>
                </div>
                <div class="pressurizacao-card-body" style="display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: var(--text-muted);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Pressão Atual:</span>
                        <strong class="pressurizacao-pressure-val" id="pval-${escapeHtml(dev.numero_serie)}" style="color: var(--primary-blue); font-size: 14px; font-weight: 600;">${pressureDisplay}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Setpoints (B1):</span>
                        <span style="font-weight: 500; color: var(--text-main);">${r1_on} / ${r1_off} psi</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Última Transmissão:</span>
                        <span class="pressurizacao-time-val" id="ptime-${escapeHtml(dev.numero_serie)}">${timeStr}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

}

function updateSinglePressurizacaoCardDom(dev) {
    const u = dev.ultima_leitura || {};
    const pressure = (u.sensor1 !== null && u.sensor1 !== undefined) ? Number(u.sensor1) : null;
    const isCrit = dev.status === 'Crítico' || (pressure !== null && pressure < 20);
    const isWarn = dev.status === 'Atenção' || (pressure !== null && pressure > 60);
    const dotClass = isCrit ? 'red' : (isWarn ? 'yellow' : 'green');

    const card = document.getElementById(`press-card-${dev.numero_serie}`);
    if (card) {
        card.classList.toggle('selected', dev.numero_serie === selectedDeviceSerial);
        const dot = card.querySelector('.status-dot-fine');
        if (dot) dot.className = `status-dot-fine ${dotClass}`;
    }

    const pvalEl = document.getElementById(`pval-${dev.numero_serie}`);
    if (pvalEl) {
        pvalEl.innerText = pressure !== null ? `${pressure.toFixed(2)} psi` : '-- psi';
    }

    const timeEl = document.getElementById(`ptime-${dev.numero_serie}`);
    if (timeEl && u.timestamp) {
        timeEl.innerText = new Date(u.timestamp).toLocaleTimeString('pt-BR');
    }
}

function initOrUpdateGauge(canvasId, value, min, max, fillColor) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    const val = (value !== null && value !== undefined && !isNaN(value)) ? Number(value) : min;
    const clamped = Math.max(min, Math.min(max, val));
    const progress = clamped - min;
    const remaining = max - clamped;

    if (activeGauges[canvasId]) {
        try {
            const chart = activeGauges[canvasId];
            if (chart && chart.canvas === canvas) {
                chart.data.datasets[0].data = [progress, remaining];
                chart.data.datasets[0].backgroundColor = [fillColor, '#e2e8f0'];
                chart.update('none');
                return;
            } else if (chart) {
                chart.destroy();
                delete activeGauges[canvasId];
            }
        } catch (e) {
            delete activeGauges[canvasId];
        }
    }

    try {
        const ctx = canvas.getContext('2d');
        activeGauges[canvasId] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [progress, remaining],
                    backgroundColor: [fillColor, '#e2e8f0'],
                    borderWidth: 0,
                    circumference: 180,
                    rotation: 270,
                    borderRadius: [4, 4]
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
        console.warn('Erro ao criar manômetro:', err);
    }
}

function selectStationForChart(serial) {
    const select = document.getElementById('pressurizacaoSelect');
    if (select) {
        select.value = serial;
        onSelectPressurizacaoChange();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

/**
 * Gráfico Interativo de Pressurização em Tempo Real
 */
async function loadPressurizacaoChart(serial, forcePeriodChange = false) {
    const canvas = document.getElementById('pressurizacaoChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const devSerial = serial || selectedDeviceSerial;
    if (!devSerial) return;

    const periodSelect = document.getElementById('pressurizacaoPeriodSelect');
    const period = periodSelect ? periodSelect.value : 'all';

    const dev = currentPressurizacoes.find(d => d.numero_serie === devSerial);
    const r1_on = Number(dev?.ultima_leitura?.rele1_on || 35.0);
    const r1_off = Number(dev?.ultima_leitura?.rele1_off || 50.0);
    const r2_on = Number(dev?.ultima_leitura?.rele2_on || 32.0);

    if (pressurizacaoChartInstance && !forcePeriodChange) {
        return;
    }

    if (pressurizacaoChartInstance) {
        pressurizacaoChartInstance.destroy();
        pressurizacaoChartInstance = null;
    }

    let labels = [];
    let pressureData = [];
    let r1OnData = [];
    let r1OffData = [];
    let r2OnData = [];

    // Histórico real (GET /api/pressurizacao/:numeroSerie/leituras?periodo=).
    // Sem dados, o gráfico abre vazio e é preenchido pelas leituras ao vivo.
    const historico = dev?.isSimulated
        ? []
        : await window.SensoriumHistory.load(`/api/pressurizacao/${encodeURIComponent(devSerial)}/leituras`, period === 'all' ? 30 : 0, period);
    if (pressurizacaoChartInstance) return; // outra carga terminou primeiro
    historico.forEach(item => {
        labels.push(window.SensoriumHistory.label(item));
        pressureData.push(item.sensor1 !== null && item.sensor1 !== undefined ? Number(Number(item.sensor1).toFixed(1)) : null);
        r1OnData.push(item.rele1_on !== null && item.rele1_on !== undefined ? Number(item.rele1_on) : r1_on);
        r1OffData.push(item.rele1_off !== null && item.rele1_off !== undefined ? Number(item.rele1_off) : r1_off);
        r2OnData.push(item.rele2_on !== null && item.rele2_on !== undefined ? Number(item.rele2_on) : r2_on);
    });

    const ctx = canvas.getContext('2d');
    pressurizacaoChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Pressão da Linha (psi)',
                    data: pressureData,
                    borderColor: '#0284c7',
                    backgroundColor: 'rgba(2, 132, 199, 0.08)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 2,
                    pointHoverRadius: 5
                },
                {
                    label: 'Partida Bomba 1 (ON)',
                    data: r1OnData,
                    borderColor: '#06b6d4',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: 'Partida Bomba 2 (ON)',
                    data: r2OnData,
                    borderColor: '#ea580c',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: 'Pressão de Corte (OFF)',
                    data: r1OffData,
                    borderColor: '#10b981',
                    borderWidth: 1.5,
                    borderDash: [3, 3],
                    fill: false,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                y: {
                    min: 0,
                    max: 70,
                    title: { display: true, text: 'Pressão Hidráulica (psi)' },
                    grid: { color: '#f1f5f9' }
                },
                x: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            }
        }
    });

    fluidTelemetry = {
        pushReading: function(r) {
            if (!pressurizacaoChartInstance) return;
            const timeStr = new Date(r.timestamp || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            
            const chart = pressurizacaoChartInstance;
            chart.data.labels.push(timeStr);
            chart.data.datasets[0].data.push(Number(r.sensor1));
            chart.data.datasets[1].data.push(r.rele1_on || r1_on);
            chart.data.datasets[2].data.push(r.rele2_on || r2_on);
            chart.data.datasets[3].data.push(r.rele1_off || r1_off);

            if (chart.data.labels.length > 35) {
                chart.data.labels.shift();
                chart.data.datasets[0].data.shift();
                chart.data.datasets[1].data.shift();
                chart.data.datasets[2].data.shift();
                chart.data.datasets[3].data.shift();
            }
            chart.update('none');
        }
    };
}

// ====================================================
// FULLSCREEN PRESENTATION MODE (CARROSSEL COM CARDS E GRÁFICO)
// ====================================================
/**
 * Renderiza a estação ativa no Modo Tela Cheia com os 4 Cards e o Gráfico dedicado
 */
function renderFullscreenStation(index) {
    if (!currentPressurizacoes || currentPressurizacoes.length === 0) return;

    index = fsCarousel.setActiveIndex(index);

    const dev = currentPressurizacoes[index];
    const u = dev.ultima_leitura || {};

    // 1. Header Metadata
    const titleEl = document.getElementById('fsDeviceTitle');
    if (titleEl) titleEl.innerText = `${dev.numero_serie} - ${dev.nome || 'Barrilete Hidráulico'}`;

    const statusPill = document.getElementById('fsStatusPill');
    const statusText = document.getElementById('fsStatusText');
    const isCrit = dev.status === 'Crítico' || (u.sensor1 !== null && u.sensor1 < 20);
    const isWarn = dev.status === 'Atenção' || (u.sensor1 !== null && u.sensor1 > 60);
    const stClass = isCrit ? 'critico' : (isWarn ? 'atencao' : 'operacional');
    const stLabel = isCrit ? 'Crítico (Subpressão)' : (isWarn ? 'Atenção (Sobrepressão)' : 'Operacional');

    if (statusPill) statusPill.className = `fs-status-pill ${stClass}`;
    if (statusText) statusText.innerText = stLabel;

    const timeEl = document.getElementById('fsLastReadingTime');
    if (timeEl) {
        const timeStr = u.timestamp ? new Date(u.timestamp).toLocaleTimeString('pt-BR') : '--:--:--';
        timeEl.innerText = `Última Leitura: ${timeStr}`;
    }

    // 2. Card 1: Manômetro de Pressão
    const pressure = (u.sensor1 !== null && u.sensor1 !== undefined) ? Number(u.sensor1) : null;
    const pColor = getPressureColor(pressure, u.rele1_on, u.rele1_off);

    const tempValEl = document.getElementById('fsTempVal');
    if (tempValEl) {
        tempValEl.innerText = pressure !== null ? pressure.toFixed(1) : '--';
        tempValEl.style.color = pColor;
    }

    const pEvalEl = document.getElementById('fsPressureEval');
    if (pEvalEl) {
        if (pressure === null) {
            pEvalEl.innerText = 'Sem Dados';
            pEvalEl.style.background = '#f1f5f9';
            pEvalEl.style.color = '#64748b';
        } else if (pressure < 20) {
            pEvalEl.innerText = 'Subpressão';
            pEvalEl.style.background = '#fef2f2';
            pEvalEl.style.color = '#dc2626';
        } else if (pressure > 60) {
            pEvalEl.innerText = 'Sobrepressão';
            pEvalEl.style.background = '#fff7ed';
            pEvalEl.style.color = '#ea580c';
        } else {
            pEvalEl.innerText = 'Estável / Ideal';
            pEvalEl.style.background = '#ecfdf5';
            pEvalEl.style.color = '#059669';
        }
    }

    updateFsGaugeChart(pressure, 0, 80, pColor);

    // 3. Card 2: Bomba 1 (Principal)
    const r1_on = u.rele1_on !== null && u.rele1_on !== undefined ? Number(u.rele1_on) : 35;
    const r1_off = u.rele1_off !== null && u.rele1_off !== undefined ? Number(u.rele1_off) : 50;
    const isR1On = pressure !== null && (u.rele1_estado === 1 || pressure <= r1_on);

    const r1Badge = document.getElementById('fsR1StateBadge');
    const r1Text = document.getElementById('fsR1StatusText');
    const r1OnVal = document.getElementById('fsR1OnVal');
    const r1OffVal = document.getElementById('fsR1OffVal');
    const r1AcVal = document.getElementById('fsR1AcVal');

    if (r1Badge) {
        r1Badge.className = `fs-relay-pill ${isR1On ? 'on' : 'off'}`;
        r1Badge.innerText = isR1On ? 'LIGADA' : 'STANDBY';
    }
    if (r1Text) {
        r1Text.innerText = isR1On ? 'OPERANDO' : 'STANDBY';
        r1Text.style.color = isR1On ? '#0284c7' : '#64748b';
    }
    if (r1OnVal) r1OnVal.innerText = `${r1_on.toFixed(1)} psi`;
    if (r1OffVal) r1OffVal.innerText = `${r1_off.toFixed(1)} psi`;
    if (r1AcVal) r1AcVal.innerText = u.rele1_acionamentos || 0;

    // 4. Card 3: Bomba 2 (Auxiliar)
    const r2_on = u.rele2_on !== null && u.rele2_on !== undefined ? Number(u.rele2_on) : 32;
    const r2_off = u.rele2_off !== null && u.rele2_off !== undefined ? Number(u.rele2_off) : 50;
    const isR2On = pressure !== null && (u.rele2_estado === 1 || pressure <= r2_on);

    const r2Badge = document.getElementById('fsR2StateBadge');
    const r2Text = document.getElementById('fsR2StatusText');
    const r2OnVal = document.getElementById('fsR2OnVal');
    const r2OffVal = document.getElementById('fsR2OffVal');
    const r2AcVal = document.getElementById('fsR2AcVal');

    if (r2Badge) {
        r2Badge.className = `fs-relay-pill ${isR2On ? 'on' : 'off'}`;
        r2Badge.innerText = isR2On ? 'LIGADA' : 'STANDBY';
    }
    if (r2Text) {
        r2Text.innerText = isR2On ? 'OPERANDO' : 'STANDBY';
        r2Text.style.color = isR2On ? '#ea580c' : '#64748b';
    }
    if (r2OnVal) r2OnVal.innerText = `${r2_on.toFixed(1)} psi`;
    if (r2OffVal) r2OffVal.innerText = `${r2_off.toFixed(1)} psi`;
    if (r2AcVal) r2AcVal.innerText = u.rele2_acionamentos || 0;

    // 5. Card 4: Diagnóstico
    const diagChip = document.getElementById('fsDiagChip');
    const diagStatus = document.getElementById('fsDiagStatusText');
    const diagDemand = document.getElementById('fsDiagDemand');

    if (diagChip && diagStatus) {
        if (isR1On && isR2On) {
            diagChip.className = 'fs-diag-chip alert';
            diagChip.innerText = 'ALTA DEMANDA';
            diagStatus.innerText = 'DUPLO BOOSTER';
            if (diagDemand) diagDemand.innerText = 'Pico de Consumo (B1+B2)';
        } else if (isR1On) {
            diagChip.className = 'fs-diag-chip normal';
            diagChip.innerText = 'RECOMPONDO';
            diagStatus.innerText = 'PRESSURIZANDO';
            if (diagDemand) diagDemand.innerText = 'Demanda Moderada (B1)';
        } else {
            diagChip.className = 'fs-diag-chip normal';
            diagChip.innerText = 'ESTÁVEL';
            diagStatus.innerText = 'PRESSURIZADO';
            if (diagDemand) diagDemand.innerText = 'Em Standby (Rede Cheia)';
        }
    }

    // 6. Gráfico em tempo real Fullscreen da estação ativa
    renderFullscreenChart(dev);

    // 7. Sincroniza select, dots e contador
    fsCarousel.renderFsDots();
    const select = document.getElementById('fsDeviceSelect');
    if (select && select.value !== dev.numero_serie) {
        select.value = dev.numero_serie;
    }
    const counterEl = document.getElementById('fsDeviceCounterText');
    if (counterEl) {
        counterEl.innerText = `Estação ${fsCarousel.getActiveIndex() + 1} de ${currentPressurizacoes.length}`;
    }
}

async function renderFullscreenChart(dev) {
    const canvas = document.getElementById('fsPressurizacaoChart');
    if (!canvas || typeof Chart === 'undefined') return;

    // Histórico real da estação (antes: pontos gerados com Math.random). Recarrega
    // ao trocar de estação ou a cada 30 s; entre uma carga e outra mantém o gráfico.
    if (fsChartSerial === dev.numero_serie && fsChartInstanceReady() && Date.now() - fsChartLoadedAt < 30000) return;
    fsChartSerial = dev.numero_serie;
    fsChartLoadedAt = Date.now();
    const historico = dev.isSimulated ? [] : await window.SensoriumHistory.load(`/api/pressurizacao/${encodeURIComponent(dev.numero_serie)}/leituras`, 30);
    if (fsChartSerial !== dev.numero_serie) return;

    const u = dev.ultima_leitura || {};
    const r1_on = u.rele1_on || 35.0;
    const r1_off = u.rele1_off || 50.0;
    const r2_on = u.rele2_on || 32.0;

    const labels = [];
    const pressureData = [];
    const r1OnData = [];
    const r1OffData = [];
    const r2OnData = [];

    historico.forEach((item) => {
        labels.push(window.SensoriumHistory.label(item));
        pressureData.push(item.sensor1 !== null && item.sensor1 !== undefined ? Number(Number(item.sensor1).toFixed(1)) : null);
        r1OnData.push(item.rele1_on !== null && item.rele1_on !== undefined ? Number(item.rele1_on) : r1_on);
        r1OffData.push(item.rele1_off !== null && item.rele1_off !== undefined ? Number(item.rele1_off) : r1_off);
        r2OnData.push(item.rele2_on !== null && item.rele2_on !== undefined ? Number(item.rele2_on) : r2_on);
    });

    if (fsPressurizacaoChartInstance) {
        try {
            fsPressurizacaoChartInstance.destroy();
        } catch (e) {}
        fsPressurizacaoChartInstance = null;
    }

    try {
        const ctx = canvas.getContext('2d');
        fsPressurizacaoChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Pressão da Linha (psi)',
                        data: pressureData,
                        borderColor: '#0284c7',
                        backgroundColor: 'rgba(2, 132, 199, 0.08)',
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.35,
                        pointRadius: 2,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Partida Bomba 1 (ON)',
                        data: r1OnData,
                        borderColor: '#06b6d4',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        fill: false,
                        pointRadius: 0
                    },
                    {
                        label: 'Partida Bomba 2 (ON)',
                        data: r2OnData,
                        borderColor: '#ea580c',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        fill: false,
                        pointRadius: 0
                    },
                    {
                        label: 'Pressão de Corte (OFF)',
                        data: r1OffData,
                        borderColor: '#10b981',
                        borderWidth: 1.5,
                        borderDash: [3, 3],
                        fill: false,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                scales: {
                    y: {
                        min: 0,
                        max: 70,
                        title: { display: true, text: 'Pressão Hidráulica (psi)' },
                        grid: { color: '#f1f5f9' }
                    },
                    x: {
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                }
            }
        });
    } catch (err) {
        console.warn('Erro ao criar gráfico fullscreen:', err);
    }
}

/**
 * Modal de Registros e Histórico
 * (Utilitários compartilhados em ../../shared/ui/registros-modal.js)
 */
function openRegistrosModal(serialFilter) {
    const modal = document.getElementById('registrosModal');
    if (!modal) return;

    modal.classList.add('active');
    document.addEventListener('keydown', handleRegistrosEscKey);
    populateModalDeviceFilter(serialFilter);
    filtrarRegistrosModal();
}

function populateModalDeviceFilter(selectedSerial) {
    const select = document.getElementById('filterModalDispositivo');
    if (!select) return;

    select.innerHTML = '<option value="todos">Todas as Estações</option>';
    currentPressurizacoes.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.numero_serie;
        opt.innerText = `${d.numero_serie} - ${d.nome || 'Pressurização'}`;
        if (selectedSerial && d.numero_serie === selectedSerial) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
}

let registrosDataItems = [];
let totalRegistrosCount = 0;

async function filtrarRegistrosModal() {
    const tbody = document.getElementById('registrosTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="10" class="table-state-message">Consultando telemetria...</td></tr>';

    const selectedDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
    const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
    const dataFim = document.getElementById('filterModalDataFim')?.value || '';

    let remoteLoaded = false;
    try {
        const queryParams = new URLSearchParams({
            page: registrosCurrentPage,
            limit: registrosPageLimit,
            numeroSerie: selectedDev,
            dataInicio: dataInicio,
            dataFim: dataFim
        });

        const res = await fetch(`${API_BASE}/api/pressurizacao/registros?${queryParams.toString()}`, {
            headers: getAuthHeaders()
        });

        if (res.ok) {
            const result = await res.json();
            if (result.success) {
                registrosDataItems = (result.data || []).map(r => ({
                    numero_serie: r.dispositivo_numero_serie || r.numero_serie,
                    nome: r.cliente || r.dispositivo_nome || r.nome,
                    timestamp: r.timestamp_leitura || r.timestamp,
                    sensor1: Number(r.sensor1 || 0),
                    rele1_on: Number(r.rele1_on || 35.0),
                    rele1_off: Number(r.rele1_off || 50.0),
                    rele1_ac: r.rele1_acionamentos || 0,
                    rele2_on: Number(r.rele2_on || 32.0),
                    rele2_off: Number(r.rele2_off || 50.0),
                    rele2_ac: r.rele2_acionamentos || 0
                }));
                const pag = result.pagination || result;
                totalRegistrosCount = pag.total || 0;
                registrosTotalPages = pag.totalPages || 1;
                registrosCurrentPage = pag.page || 1;
                remoteLoaded = true;
            }
        }
    } catch (e) {
        console.warn('[Pressurização] Falha ao consultar registros:', e.message);
    }

    if (!remoteLoaded && !window.SENSORIUM_DEMO) {
        registrosDataItems = [];
        totalRegistrosCount = 0;
        registrosTotalPages = 1;
        exibirFeedbackModal('Não foi possível consultar os registros no servidor.', 'error');
    } else if (!remoteLoaded) {
        mockRegistrosHistory = [];
        const now = Date.now();
        const devicesToInclude = selectedDev === 'todos' ? currentPressurizacoes : currentPressurizacoes.filter(d => d.numero_serie === selectedDev);

        devicesToInclude.forEach(d => {
            for (let i = 0; i < 25; i++) {
                const t = new Date(now - i * 180000);
                const p = Number((42.0 + Math.sin(i * 0.5) * 8.0 + (Math.random() * 2.0)).toFixed(1));
                mockRegistrosHistory.push({
                    numero_serie: d.numero_serie,
                    nome: d.nome,
                    timestamp: t.toISOString(),
                    sensor1: p,
                    rele1_on: 35.0,
                    rele1_off: 50.0,
                    rele1_ac: 120 + (25 - i),
                    rele2_on: 32.0,
                    rele2_off: 50.0,
                    rele2_ac: 35 + Math.floor((25 - i) / 3)
                });
            }
        });

        mockRegistrosHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        totalRegistrosCount = mockRegistrosHistory.length;
        registrosTotalPages = Math.ceil(totalRegistrosCount / registrosPageLimit) || 1;
        const start = (registrosCurrentPage - 1) * registrosPageLimit;
        registrosDataItems = mockRegistrosHistory.slice(start, start + registrosPageLimit);
    }

    renderRegistrosPage();
}

function renderRegistrosPage() {
    const tbody = document.getElementById('registrosTableBody');
    const countEl = document.getElementById('registrosTotalCount');
    const pageInd = document.getElementById('registrosPageIndicator');
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');
    if (!tbody) return;

    if (!registrosDataItems || registrosDataItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="table-state-message">Nenhum registro encontrado no período.</td></tr>';
        if (countEl) countEl.innerText = '0 registros encontrados';
        if (pageInd) pageInd.innerText = 'Página 1 de 1';
        if (btnPrev) btnPrev.disabled = true;
        if (btnNext) btnNext.disabled = true;
        return;
    }

    if (countEl) countEl.innerText = `${totalRegistrosCount} registros encontrados`;
    if (pageInd) pageInd.innerText = `Página ${registrosCurrentPage} de ${registrosTotalPages}`;
    if (btnPrev) btnPrev.disabled = registrosCurrentPage <= 1;
    if (btnNext) btnNext.disabled = registrosCurrentPage >= registrosTotalPages;

    tbody.innerHTML = registrosDataItems.map(item => {
        const timeFormatted = new Date(item.timestamp).toLocaleString('pt-BR');
        return `
            <tr>
                <td><strong>${escapeHtml(item.numero_serie)}</strong></td>
                <td>${escapeHtml(item.nome || 'Estação')}</td>
                <td>${timeFormatted}</td>
                <td><strong style="color: ${getPressureColor(item.sensor1)};">${Number(item.sensor1).toFixed(1)} psi</strong></td>
                <td>${Number(item.rele1_on).toFixed(1)} psi</td>
                <td>${Number(item.rele1_off).toFixed(1)} psi</td>
                <td>${escapeHtml(item.rele1_ac)}</td>
                <td>${Number(item.rele2_on).toFixed(1)} psi</td>
                <td>${Number(item.rele2_off).toFixed(1)} psi</td>
                <td>${escapeHtml(item.rele2_ac)}</td>
            </tr>
        `;
    }).join('');
}

function mudarPaginaRegistros(delta) {
    const newPage = registrosCurrentPage + delta;
    if (newPage >= 1 && newPage <= registrosTotalPages) {
        registrosCurrentPage = newPage;
        filtrarRegistrosModal();
    }
}

async function exportarRegistrosCSV() {
    const selectedDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
    const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
    const dataFim = document.getElementById('filterModalDataFim')?.value || '';

    const r = await baixarCsvAutenticado('/api/pressurizacao/exportar-csv',
        { numeroSerie: selectedDev, dataInicio, dataFim },
        `registros_pressurizacao_${new Date().toISOString().slice(0, 10)}.csv`);
    exibirFeedbackModal(r.message, r.ok ? 'success' : 'error');
}

function abrirConfirmacaoExclusao() {
    const modal = document.getElementById('confirmDeleteModal');
    if (modal) modal.classList.add('active');
}

async function executarExclusaoRegistros() {
    fecharConfirmacaoExclusao();

    const selectedDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
    const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
    const dataFim = document.getElementById('filterModalDataFim')?.value || '';

    try {
        const res = await fetch(`${API_BASE}/api/pressurizacao/registros`, {
            method: 'DELETE',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ numeroSerie: selectedDev, dataInicio, dataFim })
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok || result.success === false) {
            exibirFeedbackModal(result.message || 'Não foi possível apagar os registros.', 'error');
            return;
        }
        exibirFeedbackModal(result.message || 'Registros apagados com sucesso.', 'success');
    } catch (e) {
        exibirFeedbackModal('Erro de conexão ao apagar registros.', 'error');
        return;
    }

    registrosCurrentPage = 1;
    filtrarRegistrosModal();
}
