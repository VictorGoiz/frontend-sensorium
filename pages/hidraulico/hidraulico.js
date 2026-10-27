// O backend ainda não tem rotas /api/hidraulico nem eventos de socket para este tipo:
// a tela roda em MODO DEMONSTRAÇÃO (dados de shared/mocks/hidraulico.mock.js), sem
// chamadas que só gerariam 404. Quando a API existir, troque semApiHidraulico por fetch.
const HIDRAULICO_DEMO = true;
const semApiHidraulico = () => Promise.reject(new Error('Rotas /api/hidraulico ainda não existem (modo demonstração).'));

let currentHidraulicos = [];
let selectedDeviceSerial = '';
let socketInstance = null;
let isUpdatingDashboard = false;
let lastDevicesSignature = '';
let lastProcessedReadingSignature = '';
let hidraulicoChartInstance = null;
let fluidTelemetry = null;

// Fullscreen Presentation & Carousel State
let fsGaugeChartInstance = null;
let fsHidraulicoChartInstance = null;

// Estado do Modal de Registros
let registrosCurrentPage = 1;
let registrosTotalPages = 1;
const registrosPageLimit = 20;
let isFetchingRegistros = false;
let registrosDataItems = [];
let totalRegistrosCount = 0;
let mockRegistrosHistory = [];

// Controlador compartilhado da badge de transmissão (../../shared/ui/live-badge.js)
const liveBadgeCtrl = window.SensoriumLiveBadge
    ? window.SensoriumLiveBadge.createLiveBadgeController()
    : null;

// Tela cheia / carrossel: mecânica em ../../shared/ui/fullscreen-presenter.js
const fsCarousel = window.SensoriumFullscreen.bindFullscreenCarousel({
    getDevices: () => currentHidraulicos,
    render: (index) => renderFullscreenStation(index),
    standardSelectId: 'hidraulicoSelect',
    formatOptionLabel: (d, i, n) => `${d.numero_serie} - ${d.nome || 'Unidade'} (${i + 1}/${n})`,
    emptyOptionLabel: 'Nenhuma unidade',
    dotTitlePrefix: 'Ir para unidade',
    labels: { enter: 'Tela Cheia', exit: 'Sair Tela Cheia' },
    swapIcon: false,
});

function setLiveBadgeState(isLive) {
    if (liveBadgeCtrl) liveBadgeCtrl.setState(isLive);
}

document.addEventListener('DOMContentLoaded', function() {
    if (!HIDRAULICO_DEMO) initRealtimeConnection();
    loadHidraulicoData();

    // Sincronização periódica inteligente da telemetria a cada 1.5s
    if (window.SensoriumRealtime) {
        window.SensoriumRealtime.startSmartPolling(() => loadHidraulicoData(true), 1500);
    } else {
        setInterval(() => loadHidraulicoData(true), 1500);
    }

    // Simulação contínua dos dados para quando a rota do backend ainda não existir
    setInterval(simulateLiveHidraulicoStep, 1000);

});

/**
 * Inicializa conexão Socket.IO para streaming em tempo real.
 * Só o evento deste tipo de dispositivo; leituras mais antigas que a exibida
 * (ou repetidas, já que o backend envia hidraulico_reading e dashboard_update juntos) são ignoradas.
 */
function initRealtimeConnection() {
    if (!window.SensoriumRealtime) return;
    const receber = (data) => {
        if (!data || !data.numeroSerie) return;
        const dev = currentHidraulicos.find(d => d.numero_serie === data.numeroSerie);
        if (!window.SensoriumRealtime.isNewerReading(data, dev && dev.ultima_leitura)) return;
        handleLiveHidraulicoReading(data);
    };
    socketInstance = window.SensoriumRealtime.createRealtimeSocket({
        logPrefix: 'Hidráulico',
        events: {
            hidraulico_reading: receber,
            dashboard_update: (pacote) => {
                if (pacote?.type === 'hidraulico_data' && pacote.data) receber(pacote.data);
            }
        },
        onDisconnect: () => setLiveBadgeState(false)
    });
}

/**
 * Carrega dados das unidades hidráulicas via API (com fallback nos simulados)
 */
async function loadHidraulicoData(silent = false) {
    if (isUpdatingDashboard) return;
    isUpdatingDashboard = true;

    try {
        let loadedData = null;

        try {
            const res = await semApiHidraulico(`${API_BASE}/api/hidraulico`, {
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const result = await res.json();
                if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                    loadedData = result.data;
                }
            }
        } catch (apiErr) {
            if (!silent) console.warn('[Hidráulico] API ainda não disponível. Utilizando dados de demonstração frontend:', apiErr.message);
        }

        if (loadedData !== null && loadedData.length > 0) {
            currentHidraulicos = window.SensoriumRealtime ? window.SensoriumRealtime.mergeKeepingNewest(currentHidraulicos, loadedData) : loadedData;
        } else if (currentHidraulicos.length === 0) {
            currentHidraulicos = JSON.parse(JSON.stringify(SIMULATED_HIDRAULICO_DEVICES));
        }

        populateHidraulicoSelect(currentHidraulicos);
        renderHidraulicoGrid(currentHidraulicos);
        updateExecutiveSummary(currentHidraulicos);

        if (document.body.classList.contains('fullscreen-active')) {
            renderFullscreenStation(fsCarousel.getActiveIndex());
        }

        const hasData = currentHidraulicos.length > 0 && currentHidraulicos.some(d => d.ultima_leitura && d.ultima_leitura.sensor1 !== null && d.ultima_leitura.sensor1 !== undefined);
        if (hasData) {
            setLiveBadgeState(true);
        } else if (currentHidraulicos.length === 0) {
            setLiveBadgeState(false);
        }

        if (selectedDeviceSerial && !fluidTelemetry) {
            loadHidraulicoChart(selectedDeviceSerial, false);
        } else if (selectedDeviceSerial) {
            const dev = currentHidraulicos.find(d => d.numero_serie === selectedDeviceSerial);
            if (dev && dev.ultima_leitura) {
                const u = dev.ultima_leitura;
                const curSig = `${selectedDeviceSerial}_${u.timestamp}_${u.sensor1}_${u.rele1_on}_${u.rele1_off}`;
                if (lastProcessedReadingSignature !== curSig) {
                    lastProcessedReadingSignature = curSig;
                    handleLiveHidraulicoReading({
                        numeroSerie: dev.numero_serie,
                        ...dev.ultima_leitura
                    });
                }
            }
        }
    } catch (err) {
        if (!silent) console.warn('[Hidráulico] Erro ao sincronizar:', err.message);
        if (currentHidraulicos.length === 0) {
            setLiveBadgeState(false);
        }
    } finally {
        isUpdatingDashboard = false;
    }
}

/**
 * Simulação contínua do ciclo de carga, alívio e recirculação da HPU
 * (Dados e motor simulados em ../../shared/mocks/hidraulico.mock.js)
 */
function simulateLiveHidraulicoStep() {
    if (!currentHidraulicos || currentHidraulicos.length === 0) return;
    const hasSimulated = typeof stepHidraulicoSimulation === 'function'
        ? stepHidraulicoSimulation(currentHidraulicos)
        : false;

    if (hasSimulated) {
        setLiveBadgeState(true);
        renderHidraulicoGrid(currentHidraulicos);
        updateExecutiveSummary(currentHidraulicos);

        if (document.body.classList.contains('fullscreen-active')) {
            renderFullscreenStation(fsCarousel.getActiveIndex());
        }

        if (selectedDeviceSerial) {
            const dev = currentHidraulicos.find(d => d.numero_serie === selectedDeviceSerial);
            if (dev && dev.ultima_leitura) {
                handleLiveHidraulicoReading({
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
function handleLiveHidraulicoReading(reading) {
    if (!reading || !reading.numeroSerie) return;
    const { numeroSerie, sensor1, rele1_on, rele1_off, rele1_acionamentos, rele2_on, rele2_off, rele2_acionamentos, timestamp } = reading;

    lastProcessedReadingSignature = `${numeroSerie}_${timestamp}_${sensor1}_${rele1_on}_${rele1_off}`;
    setLiveBadgeState(true);

    let dev = currentHidraulicos.find(d => d.numero_serie === numeroSerie);
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
        const activeDev = currentHidraulicos[fsCarousel.getActiveIndex()];
        if (activeDev && activeDev.numero_serie === numeroSerie) {
            renderFullscreenStation(fsCarousel.getActiveIndex());
        }
    }
}

/**
 * Preenche o select de unidades HPU no header
 */
function populateHidraulicoSelect(devices) {
    const select = document.getElementById('hidraulicoSelect');
    if (!select) return;

    const currentSelected = select.value;
    select.innerHTML = '';

    if (!devices || devices.length === 0) {
        select.innerHTML = '<option value="">Nenhuma unidade encontrada</option>';
        selectedDeviceSerial = '';
        return;
    }

    devices.forEach((dev, idx) => {
        const opt = document.createElement('option');
        opt.value = dev.numero_serie;
        opt.innerText = `${dev.numero_serie} - ${dev.nome || 'Unidade Hidráulica HPU'}`;
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

function onSelectHidraulicoChange() {
    const select = document.getElementById('hidraulicoSelect');
    if (!select) return;
    selectedDeviceSerial = select.value;
    loadHidraulicoChart(selectedDeviceSerial, false);
    updateExecutiveSummary(currentHidraulicos);
}

/**
 * Atualiza os 4 cards executivos no topo
 */
function updateExecutiveSummary(devices) {
    const totalEl = document.getElementById('execTotalHidraulico');
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
        pValEl.innerText = pressure !== null ? pressure.toFixed(2) : '--';
        pValEl.classList.add('pulse');
        setTimeout(() => pValEl.classList.remove('pulse'), 120);
    }

    if (dSerialEl) dSerialEl.innerText = reading.numeroSerie || '--';

    const r1_on = reading.rele1_on !== null && reading.rele1_on !== undefined ? Number(reading.rele1_on) : 130;
    const r1_off = reading.rele1_off !== null && reading.rele1_off !== undefined ? Number(reading.rele1_off) : 180;
    const r2_on = reading.rele2_on !== null && reading.rele2_on !== undefined ? Number(reading.rele2_on) : 115;
    const r2_off = reading.rele2_off !== null && reading.rele2_off !== undefined ? Number(reading.rele2_off) : 180;

    const isR1On = pressure !== null && (reading.rele1_estado === 1 || pressure <= r1_on);
    const isR2On = pressure !== null && (reading.rele2_estado === 1 || pressure <= r2_on);

    if (r1StatusEl) {
        r1StatusEl.innerText = isR1On ? 'ATIVO (ON)' : 'DESLIGADO (OFF)';
        r1StatusEl.style.color = isR1On ? '#10b981' : '#64748b';
    }
    if (r1OnEl) r1OnEl.innerText = Number(r1_on).toFixed(1);
    if (r1OffEl) r1OffEl.innerText = Number(r1_off).toFixed(1);
    if (r1AcEl) r1AcEl.innerText = reading.rele1_acionamentos ?? '--';

    if (r2StatusEl) {
        r2StatusEl.innerText = isR2On ? 'ATIVO (ON)' : 'DESLIGADO (OFF)';
        r2StatusEl.style.color = isR2On ? '#10b981' : '#64748b';
    }
    if (r2OnEl) r2OnEl.innerText = Number(r2_on).toFixed(1);
    if (r2OffEl) r2OffEl.innerText = Number(r2_off).toFixed(1);
    if (r2AcEl) r2AcEl.innerText = reading.rele2_acionamentos ?? '--';

    if (sysStatusEl) {
        if (pressure === null) {
            sysStatusEl.className = 'val-pill gray';
            sysStatusEl.innerText = 'Sem Dados';
        } else if (pressure < 80.0) {
            sysStatusEl.className = 'val-pill red';
            sysStatusEl.innerText = 'Crítico';
        } else if (pressure > 210.0) {
            sysStatusEl.className = 'val-pill yellow';
            sysStatusEl.innerText = 'Atenção';
        } else {
            sysStatusEl.className = 'val-pill green';
            sysStatusEl.innerText = 'Normal';
        }
    }
}

function getPressureColor(val, minOn, maxOff) {
    if (val === null || val === undefined) return '#0f172a';
    const v = Number(val);
    const on = minOn ? Number(minOn) : 130;
    const off = maxOff ? Number(maxOff) : 180;

    if (v < 80) return '#ef4444';
    if (v <= on) return '#0284c7';
    if (v >= off && v <= 200) return '#10b981';
    if (v > 200) return '#ea580c';
    return '#0284c7';
}

/**
 * Renderiza o Grid de Cards de Unidades Hidráulicas
 */
function renderHidraulicoGrid(devices) {
    const grid = document.getElementById('hidraulicoGrid');
    if (!grid) return;

    if (!devices || devices.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-muted);">Nenhuma unidade hidráulica monitorada.</div>';
        return;
    }

    const summaryEl = document.getElementById('hidraulicoListSummary');
    if (summaryEl) summaryEl.innerText = `${devices.length} unidade(s) conectadas`;

    const existingCards = grid.querySelectorAll('.hidraulico-card');
    const hasMatchingDom = existingCards.length === devices.length && devices.every(d => document.getElementById(`hpu-card-${d.numero_serie}`));

    if (hasMatchingDom) {
        devices.forEach(dev => {
            updateSingleHidraulicoCardDom(dev);
        });
        return;
    }

    grid.innerHTML = devices.map(dev => {
        const u = dev.ultima_leitura || {};
        const pressure = (u.sensor1 !== null && u.sensor1 !== undefined) ? Number(u.sensor1) : null;
        const pressureDisplay = pressure !== null ? `${pressure.toFixed(2)} bar` : '-- bar';
        const isSel = dev.numero_serie === selectedDeviceSerial;

        const isCrit = dev.status === 'Crítico' || (pressure !== null && pressure < 80);
        const isWarn = dev.status === 'Atenção' || (pressure !== null && pressure > 200);
        const dotClass = isCrit ? 'red' : (isWarn ? 'yellow' : 'green');
        const timeStr = u.timestamp ? new Date(u.timestamp).toLocaleTimeString('pt-BR') : 'Sem leitura';

        return `
            <div class="hidraulico-card ${isSel ? 'selected' : ''}" id="hpu-card-${escapeHtml(dev.numero_serie)}" data-serie="${escapeHtml(dev.numero_serie)}" onclick="selectStationForChart(this.dataset.serie)">
                <div class="hidraulico-card-header">
                    <span class="hidraulico-card-title">Unidade #${escapeHtml(dev.numero_serie)}</span>
                    <span class="status-dot-fine ${dotClass}" title="${escapeHtml(dev.status || 'Operacional')}"></span>
                </div>
                <div class="hidraulico-card-body">
                    <div class="hidraulico-row">
                        <span>Pressão Atual:</span>
                        <strong class="hidraulico-live-val hidraulico-pressure-val" id="pval-${escapeHtml(dev.numero_serie)}" style="color: var(--primary-blue); font-size: 14px;">${pressureDisplay}</strong>
                    </div>
                    <div class="hidraulico-row">
                        <span>Última Transmissão:</span>
                        <span class="hidraulico-time-val" id="ptime-${escapeHtml(dev.numero_serie)}">${timeStr}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function updateSingleHidraulicoCardDom(dev) {
    const u = dev.ultima_leitura || {};
    const pressure = (u.sensor1 !== null && u.sensor1 !== undefined) ? Number(u.sensor1) : null;
    const isCrit = dev.status === 'Crítico' || (pressure !== null && pressure < 80);
    const isWarn = dev.status === 'Atenção' || (pressure !== null && pressure > 200);
    const dotClass = isCrit ? 'red' : (isWarn ? 'yellow' : 'green');

    const card = document.getElementById(`hpu-card-${dev.numero_serie}`);
    if (card) {
        card.classList.toggle('selected', dev.numero_serie === selectedDeviceSerial);
        const dot = card.querySelector('.status-dot-fine');
        if (dot) dot.className = `status-dot-fine ${dotClass}`;
    }

    const pvalEl = document.getElementById(`pval-${dev.numero_serie}`);
    if (pvalEl) {
        pvalEl.innerText = pressure !== null ? `${pressure.toFixed(2)} bar` : '-- bar';
    }

    const timeEl = document.getElementById(`ptime-${dev.numero_serie}`);
    if (timeEl && u.timestamp) {
        timeEl.innerText = new Date(u.timestamp).toLocaleTimeString('pt-BR');
    }
}

function selectStationForChart(serial) {
    const select = document.getElementById('hidraulicoSelect');
    if (select) {
        select.value = serial;
        onSelectHidraulicoChange();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

/**
 * Gráfico Interativo de Pressão Hidráulica em Tempo Real
 */
async function loadHidraulicoChart(serial, forcePeriodChange = false) {
    const canvas = document.getElementById('hidraulicoChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const devSerial = serial || selectedDeviceSerial;
    if (!devSerial) return;

    const periodSelect = document.getElementById('hidraulicoPeriodSelect');
    const period = periodSelect ? periodSelect.value : 'all';

    const dev = currentHidraulicos.find(d => d.numero_serie === devSerial);
    const r1_on = Number(dev?.ultima_leitura?.rele1_on || 130.0);
    const r1_off = Number(dev?.ultima_leitura?.rele1_off || 180.0);
    const r2_on = Number(dev?.ultima_leitura?.rele2_on || 115.0);

    if (hidraulicoChartInstance && !forcePeriodChange) {
        return;
    }

    if (hidraulicoChartInstance) {
        hidraulicoChartInstance.destroy();
        hidraulicoChartInstance = null;
    }

    let labels = [];
    let pressureData = [];
    let r1OnData = [];
    let r1OffData = [];
    let r2OnData = [];

    // Tenta carregar histórico do backend se a rota estiver criada
    let hasLoadedRemote = false;
    try {
        const queryParams = new URLSearchParams({ serial: devSerial, period: period });
        const res = await semApiHidraulico(`${API_BASE}/api/hidraulico/historico?${queryParams.toString()}`, {
            headers: getAuthHeaders()
        });
        if (res.ok) {
            const histRes = await res.json();
            if (histRes.success && Array.isArray(histRes.data) && histRes.data.length > 0) {
                histRes.data.forEach(item => {
                    const t = new Date(item.timestamp);
                    labels.push(t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
                    pressureData.push(item.sensor1 !== null && item.sensor1 !== undefined ? Number(Number(item.sensor1).toFixed(1)) : null);
                    r1OnData.push(item.rele1_on !== null && item.rele1_on !== undefined ? Number(item.rele1_on) : r1_on);
                    r1OffData.push(item.rele1_off !== null && item.rele1_off !== undefined ? Number(item.rele1_off) : r1_off);
                    r2OnData.push(item.rele2_on !== null && item.rele2_on !== undefined ? Number(item.rele2_on) : r2_on);
                });
                hasLoadedRemote = true;
            }
        }
    } catch (e) {}

    if (!hasLoadedRemote) {
        const now = Date.now();
        const pointsCount = period === '1h' ? 30 : (period === '6h' ? 50 : 25);
        const intervalMs = (period === '1h' ? 60000 : 3000) * 2;

        let baseP = Number(dev?.ultima_leitura?.sensor1 || 155.0);
        for (let i = pointsCount - 1; i >= 0; i--) {
            const t = new Date(now - i * intervalMs);
            labels.push(t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
            
            const offset = Math.sin(i * 0.4) * 15.0 + (Math.random() * 4.0);
            const p = Math.max(90, Math.min(195, baseP + offset));
            pressureData.push(Number(p.toFixed(1)));
            r1OnData.push(r1_on);
            r1OffData.push(r1_off);
            r2OnData.push(r2_on);
        }
    }

    const ctx = canvas.getContext('2d');
    hidraulicoChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Pressão (Sensor 1)',
                    data: pressureData,
                    borderColor: '#1e60ac',
                    backgroundColor: 'rgba(30, 96, 172, 0.08)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 2,
                    pointHoverRadius: 5
                },
                {
                    label: 'Setpoint ON',
                    data: r1OnData,
                    borderColor: '#10b981',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: 'Setpoint OFF',
                    data: r1OffData,
                    borderColor: '#ef4444',
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
                    min: 50,
                    max: 250,
                    title: { display: true, text: 'Pressão (bar)' },
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
            if (!hidraulicoChartInstance) return;
            const timeStr = new Date(r.timestamp || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            
            const chart = hidraulicoChartInstance;
            chart.data.labels.push(timeStr);
            chart.data.datasets[0].data.push(Number(r.sensor1));
            if (chart.data.datasets[1]) chart.data.datasets[1].data.push(r.rele1_on || r1_on);
            if (chart.data.datasets[2]) chart.data.datasets[2].data.push(r.rele1_off || r1_off);

            if (chart.data.labels.length > 35) {
                chart.data.labels.shift();
                chart.data.datasets[0].data.shift();
                if (chart.data.datasets[1]) chart.data.datasets[1].data.shift();
                if (chart.data.datasets[2]) chart.data.datasets[2].data.shift();
            }
            chart.update('none');
        }
    };
}

// ====================================================
// FULLSCREEN PRESENTATION MODE (CARROSSEL COM CARDS E GRÁFICO)
// ====================================================
/**
 * Renderiza a unidade HPU ativa no Modo Tela Cheia com os 4 Cards e o Gráfico dedicado
 */
function renderFullscreenStation(index) {
    if (!currentHidraulicos || currentHidraulicos.length === 0) return;

    index = fsCarousel.setActiveIndex(index);

    const dev = currentHidraulicos[index];
    const u = dev.ultima_leitura || {};

    // 1. Header Metadata
    const titleEl = document.getElementById('fsDeviceTitle');
    if (titleEl) titleEl.innerText = `${dev.numero_serie} - ${dev.nome || 'Unidade Hidráulica HPU'}`;

    const statusPill = document.getElementById('fsStatusPill');
    const statusText = document.getElementById('fsStatusText');
    const isCrit = dev.status === 'Crítico' || (u.sensor1 !== null && u.sensor1 < 80);
    const isWarn = dev.status === 'Atenção' || (u.sensor1 !== null && u.sensor1 > 200);
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
        } else if (pressure < 80) {
            pEvalEl.innerText = 'Subpressão';
            pEvalEl.style.background = '#fef2f2';
            pEvalEl.style.color = '#dc2626';
        } else if (pressure > 200) {
            pEvalEl.innerText = 'Sobrepressão';
            pEvalEl.style.background = '#fff7ed';
            pEvalEl.style.color = '#ea580c';
        } else {
            pEvalEl.innerText = 'Estável / Ideal';
            pEvalEl.style.background = '#ecfdf5';
            pEvalEl.style.color = '#059669';
        }
    }

    updateFsGaugeChart(pressure, 0, 250, pColor);

    // 3. Card 2: Bomba de Óleo (Principal)
    const r1_on = u.rele1_on !== null && u.rele1_on !== undefined ? Number(u.rele1_on) : 130;
    const r1_off = u.rele1_off !== null && u.rele1_off !== undefined ? Number(u.rele1_off) : 180;
    const isR1On = pressure !== null && (u.rele1_estado === 1 || pressure <= r1_on);

    const r1Badge = document.getElementById('fsR1StateBadge');
    const r1Text = document.getElementById('fsR1StatusText');
    const r1OnVal = document.getElementById('fsR1OnVal');
    const r1OffVal = document.getElementById('fsR1OffVal');
    const r1AcVal = document.getElementById('fsR1AcVal');

    if (r1Badge) {
        r1Badge.className = `fs-relay-pill ${isR1On ? 'on' : 'off'}`;
        r1Badge.innerText = isR1On ? 'EM CARGA' : 'ALÍVIO';
    }
    if (r1Text) {
        r1Text.innerText = isR1On ? 'BOMBA OPERANDO' : 'ALÍVIO / STANDBY';
        r1Text.style.color = isR1On ? '#0284c7' : '#64748b';
    }
    if (r1OnVal) r1OnVal.innerText = `${r1_on.toFixed(1)} bar`;
    if (r1OffVal) r1OffVal.innerText = `${r1_off.toFixed(1)} bar`;
    if (r1AcVal) r1AcVal.innerText = u.rele1_acionamentos || 0;

    // 4. Card 3: Tanque / Recirculação
    const r2_on = u.rele2_on !== null && u.rele2_on !== undefined ? Number(u.rele2_on) : 115;
    const r2_off = u.rele2_off !== null && u.rele2_off !== undefined ? Number(u.rele2_off) : 180;
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
        r2Text.innerText = isR2On ? 'RECIRCULANDO' : 'STANDBY';
        r2Text.style.color = isR2On ? '#ea580c' : '#64748b';
    }
    if (r2OnVal) r2OnVal.innerText = `${r2_on.toFixed(1)} bar`;
    if (r2OffVal) r2OffVal.innerText = `${r2_off.toFixed(1)} bar`;
    if (r2AcVal) r2AcVal.innerText = u.rele2_acionamentos || 0;

    // 5. Card 4: Diagnóstico & Supervisão HPU
    const diagChip = document.getElementById('fsDiagChip');
    const diagStatus = document.getElementById('fsDiagStatusText');
    const diagOilLevel = document.getElementById('fsDiagOilLevel');
    const diagOilTemp = document.getElementById('fsDiagOilTemp');

    if (diagChip && diagStatus) {
        if (isR1On && isR2On) {
            diagChip.className = 'fs-diag-chip alert';
            diagChip.innerText = 'ALTA DEMANDA';
            diagStatus.innerText = 'DUPLO CIRCUITO';
            if (diagOilLevel) diagOilLevel.innerText = 'Em Carga Máxima';
        } else if (isR1On) {
            diagChip.className = 'fs-diag-chip normal';
            diagChip.innerText = 'EM CARGA';
            diagStatus.innerText = 'PRESSURIZANDO';
            if (diagOilLevel) diagOilLevel.innerText = 'Normal (88%)';
        } else {
            diagChip.className = 'fs-diag-chip normal';
            diagChip.innerText = 'ESTÁVEL';
            diagStatus.innerText = 'CIRCUITO PRONTO';
            if (diagOilLevel) diagOilLevel.innerText = 'Normal (88%)';
        }
    }

    // 6. Gráfico em tempo real Fullscreen da unidade ativa
    renderFullscreenChart(dev);

    // 7. Sincroniza select, dots e contador
    fsCarousel.renderFsDots();
    const select = document.getElementById('fsDeviceSelect');
    if (select && select.value !== dev.numero_serie) {
        select.value = dev.numero_serie;
    }
    const counterEl = document.getElementById('fsDeviceCounterText');
    if (counterEl) {
        counterEl.innerText = `Unidade ${fsCarousel.getActiveIndex() + 1} de ${currentHidraulicos.length}`;
    }
}

function renderFullscreenChart(dev) {
    const canvas = document.getElementById('fsHidraulicoChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const u = dev.ultima_leitura || {};
    const r1_on = Number(u.rele1_on || 130.0);
    const r1_off = Number(u.rele1_off || 180.0);
    const r2_on = Number(u.rele2_on || 115.0);

    const labels = [];
    const pressureData = [];
    const r1OnData = [];
    const r1OffData = [];
    const r2OnData = [];

    const now = Date.now();
    const pointsCount = 30;
    const intervalMs = 3000;

    let baseP = Number(u.sensor1 || 155.0);
    for (let i = pointsCount - 1; i >= 0; i--) {
        const t = new Date(now - i * intervalMs);
        labels.push(t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        const offset = Math.sin(i * 0.45) * 14.0 + (Math.random() * 3.5);
        const p = Math.max(90, Math.min(195, baseP + offset));
        pressureData.push(Number(p.toFixed(1)));
        r1OnData.push(r1_on);
        r1OffData.push(r1_off);
        r2OnData.push(r2_on);
    }

    if (fsHidraulicoChartInstance) {
        try {
            fsHidraulicoChartInstance.destroy();
        } catch (e) {}
        fsHidraulicoChartInstance = null;
    }

    try {
        const ctx = canvas.getContext('2d');
        fsHidraulicoChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Pressão da Linha (bar)',
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
                        label: 'Carga Bomba Principal (ON)',
                        data: r1OnData,
                        borderColor: '#06b6d4',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        fill: false,
                        pointRadius: 0
                    },
                    {
                        label: 'Recirculação Tanque (ON)',
                        data: r2OnData,
                        borderColor: '#ea580c',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        fill: false,
                        pointRadius: 0
                    },
                    {
                        label: 'Pressão de Alívio (OFF)',
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
                        min: 50,
                        max: 250,
                        title: { display: true, text: 'Pressão Hidráulica (bar)' },
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

    select.innerHTML = '<option value="todos">Todas as Unidades</option>';
    currentHidraulicos.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.numero_serie;
        opt.innerText = `${d.numero_serie} - ${d.nome || 'Unidade Hidráulica'}`;
        if (selectedSerial && d.numero_serie === selectedSerial) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
}

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
            serial: selectedDev,
            dataInicio: dataInicio,
            dataFim: dataFim
        });

        const res = await semApiHidraulico(`${API_BASE}/api/hidraulico/registros?${queryParams.toString()}`, {
            headers: getAuthHeaders()
        });

        if (res.ok) {
            const result = await res.json();
            if (result.success) {
                registrosDataItems = (result.data || []).map(r => ({
                    numero_serie: r.numero_serie,
                    nome: r.dispositivo_nome || r.nome,
                    timestamp: r.timestamp,
                    sensor1: Number(r.sensor1 || 0),
                    rele1_on: Number(r.rele1_on || 130.0),
                    rele1_off: Number(r.rele1_off || 180.0),
                    rele1_ac: r.rele1_acionamentos || 0,
                    rele2_on: Number(r.rele2_on || 115.0),
                    rele2_off: Number(r.rele2_off || 180.0),
                    rele2_ac: r.rele2_acionamentos || 0
                }));
                totalRegistrosCount = result.total || 0;
                registrosTotalPages = result.totalPages || 1;
                registrosCurrentPage = result.page || 1;
                remoteLoaded = true;
            }
        }
    } catch (e) {
        // Fallback local se backend ainda não foi criado
    }

    if (!remoteLoaded) {
        mockRegistrosHistory = [];
        const now = Date.now();
        const devicesToInclude = selectedDev === 'todos' ? currentHidraulicos : currentHidraulicos.filter(d => d.numero_serie === selectedDev);

        devicesToInclude.forEach(d => {
            for (let i = 0; i < 25; i++) {
                const t = new Date(now - i * 180000);
                const p = Number((155.0 + Math.sin(i * 0.5) * 18.0 + (Math.random() * 4.0)).toFixed(1));
                mockRegistrosHistory.push({
                    numero_serie: d.numero_serie,
                    nome: d.nome,
                    timestamp: t.toISOString(),
                    sensor1: p,
                    rele1_on: 130.0,
                    rele1_off: 180.0,
                    rele1_ac: 340 + (25 - i),
                    rele2_on: 115.0,
                    rele2_off: 180.0,
                    rele2_ac: 85 + Math.floor((25 - i) / 3)
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
                <td>${escapeHtml(item.nome || 'Unidade HPU')}</td>
                <td>${timeFormatted}</td>
                <td><strong style="color: ${getPressureColor(item.sensor1)};">${Number(item.sensor1).toFixed(1)} bar</strong></td>
                <td>${Number(item.rele1_on).toFixed(1)} bar</td>
                <td>${Number(item.rele1_off).toFixed(1)} bar</td>
                <td>${escapeHtml(item.rele1_ac)}</td>
                <td>${Number(item.rele2_on).toFixed(1)} bar</td>
                <td>${Number(item.rele2_off).toFixed(1)} bar</td>
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

    try {
        const queryParams = new URLSearchParams({
            serial: selectedDev,
            dataInicio: dataInicio,
            dataFim: dataFim
        });

        const res = await semApiHidraulico(`${API_BASE}/api/hidraulico/exportar-csv?${queryParams.toString()}`, {
            headers: getAuthHeaders()
        });

        if (res.ok) {
            const csvText = await res.text();
            const blob = new Blob(["\ufeff", csvText], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `registros_hidraulico_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            return;
        }
    } catch (e) {
        // Fallback local se backend não responder
    }

    if (!mockRegistrosHistory || mockRegistrosHistory.length === 0) {
        alert('Nenhum registro disponível para exportação.');
        return;
    }

    let csv = 'Unidade_HPU;Aplicacao;Data_Hora;Pressao_bar;Bomba_Carga_ON_bar;Bomba_Alivio_OFF_bar;Partidas_Bomba;Recirculacao_ON_bar;Recirculacao_OFF_bar;Ciclos_Filtragem\r\n';
    mockRegistrosHistory.forEach(r => {
        csv += `${r.numero_serie};${r.nome};${r.timestamp};${r.sensor1};${r.rele1_on};${r.rele1_off};${r.rele1_ac};${r.rele2_on};${r.rele2_off};${r.rele2_ac}\r\n`;
    });

    const blob = new Blob(["\ufeff", csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registros_hidraulico_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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

    let feedbackMsg = 'Registros do período selecionado limpos com sucesso.';

    try {
        const queryParams = new URLSearchParams({
            serial: selectedDev,
            dataInicio: dataInicio,
            dataFim: dataFim
        });

        const res = await semApiHidraulico(`${API_BASE}/api/hidraulico/registros?${queryParams.toString()}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (res.ok) {
            const result = await res.json();
            feedbackMsg = result.message || feedbackMsg;
        }
    } catch (e) {}

    exibirFeedbackModal(feedbackMsg, 'success');
    registrosCurrentPage = 1;
    filtrarRegistrosModal();
}
