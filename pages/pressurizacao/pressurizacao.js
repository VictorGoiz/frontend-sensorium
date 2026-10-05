let currentPressurizacoes = [];
let selectedDeviceSerial = '';
let socketInstance = null;
let isUpdatingDashboard = false;
let lastDevicesSignature = '';
let lastProcessedReadingSignature = '';
let liveBadgeWatchdog = null;
let pressurizacaoChartInstance = null;
let fluidTelemetry = null;

// Fullscreen Presentation & Carousel State
let fullscreenActiveIndex = 0;
let fsAutoplayInterval = null;
const fsAutoplayDuration = 8000;
let fsGaugeChartInstance = null;
let fsPressurizacaoChartInstance = null;
let fsKeyboardListenerAttached = false;

// Estado do Modal de Registros
let registrosCurrentPage = 1;
let registrosTotalPages = 1;
const registrosPageLimit = 20;
let isFetchingRegistros = false;

// ----------------------------------------------------
// DISPOSITIVOS SIMULADOS DE EXEMPLO (DEMONSTRAÇÃO FRONTEND)
// ----------------------------------------------------
const SIMULATED_PRESSURIZACAO_DEVICES = [
    {
        numero_serie: 'PRESS-01',
        nome: 'Barrilete Principal - Torre A',
        cliente: 'Edifício Corporativo Horizon',
        status: 'Operacional',
        isSimulated: true,
        ultima_leitura: {
            sensor1: 44.5, // Pressão em psi
            rele1_on: 35.0,
            rele1_off: 50.0,
            rele1_acionamentos: 142,
            rele1_estado: 0, // Desligada (pressão acima do mín)
            rele2_on: 32.0,
            rele2_off: 50.0,
            rele2_acionamentos: 38,
            rele2_estado: 0,
            timestamp: new Date().toISOString()
        }
    },
    {
        numero_serie: 'PRESS-02',
        nome: 'Estação Elevatória - Bloco B',
        cliente: 'Residencial Reserva das Águas',
        status: 'Operacional',
        isSimulated: true,
        ultima_leitura: {
            sensor1: 38.2,
            rele1_on: 30.0,
            rele1_off: 48.0,
            rele1_acionamentos: 96,
            rele1_estado: 0,
            rele2_on: 28.0,
            rele2_off: 48.0,
            rele2_acionamentos: 19,
            rele2_estado: 0,
            timestamp: new Date().toISOString()
        }
    },
    {
        numero_serie: 'PRESS-03',
        nome: 'Booster Hidropneumático - Subsolo',
        cliente: 'Centro Logístico Integrado',
        status: 'Operacional',
        isSimulated: true,
        ultima_leitura: {
            sensor1: 48.0,
            rele1_on: 40.0,
            rele1_off: 60.0,
            rele1_acionamentos: 215,
            rele1_estado: 0,
            rele2_on: 36.0,
            rele2_off: 60.0,
            rele2_acionamentos: 52,
            rele2_estado: 0,
            timestamp: new Date().toISOString()
        }
    }
];

/**
 * Atualiza o estado da badge de transmissão (Verde pulsante se ao vivo, Cinza se sem dados)
 */
function setLiveBadgeState(isLive) {
    const badge = document.getElementById('livePresentationBadge');
    const badgeText = document.getElementById('liveBadgeText');
    if (!badge) return;

    if (isLive) {
        badge.classList.add('active');
        if (badgeText) badgeText.innerText = 'TRANSMISSÃO AO VIVO';

        if (liveBadgeWatchdog) clearTimeout(liveBadgeWatchdog);
        liveBadgeWatchdog = setTimeout(() => {
            setLiveBadgeState(false);
        }, 15000);
    } else {
        badge.classList.remove('active');
        if (badgeText) badgeText.innerText = 'AGUARDANDO DADOS';
    }
}

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

    initRealtimeConnection();
    loadPressurizacaoData();

    // Sincronização periódica da telemetria a cada 1.5s
    setInterval(() => {
        loadPressurizacaoData(true);
    }, 1500);

    // Simulação contínua dos dados para quando a rota do backend ainda não existir
    setInterval(simulateLivePressurizacaoStep, 1000);

    // Monitora mudanças de tela cheia para atualizar botão e modo apresentação
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
});

/**
 * Inicializa conexão Socket.IO para streaming em tempo real
 */
function initRealtimeConnection() {
    if (typeof io !== 'undefined') {
        try {
            const socketUrl = window.API_BASE || (window.location.origin.includes(':') ? window.location.origin : 'http://localhost:3000');
            socketInstance = io(socketUrl, {
                auth: { token: localStorage.getItem('sensorium_token') },
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                transports: ['websocket', 'polling']
            });

            socketInstance.on('connect', () => {
                console.log('[Pressurização Socket] Conectado em tempo real.');
            });

            socketInstance.on('pressurizacao_reading', (data) => {
                handleLivePressurizacaoReading(data);
            });

            socketInstance.on('rele_reading', (data) => {
                handleLivePressurizacaoReading(data);
            });

            socketInstance.on('dashboard_update', (data) => {
                if (data?.data && (data.type === 'pressurizacao_data' || data.type === 'reles_data')) {
                    handleLivePressurizacaoReading(data.data);
                } else {
                    loadPressurizacaoData(true);
                }
            });

            socketInstance.on('disconnect', () => {
                console.warn('[Pressurização Socket] Desconectado.');
                setLiveBadgeState(false);
            });
        } catch (err) {
            console.error('[Pressurização Socket] Erro ao conectar:', err);
            setLiveBadgeState(false);
        }
    }
}

function getAuthHeaders() {
    const token = localStorage.getItem('sensorium_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
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
            currentPressurizacoes = loadedData;
        } else if (currentPressurizacoes.length === 0) {
            currentPressurizacoes = JSON.parse(JSON.stringify(SIMULATED_PRESSURIZACAO_DEVICES));
        }

        populatePressurizacaoSelect(currentPressurizacoes);
        renderPressurizacaoGrid(currentPressurizacoes);
        updateExecutiveSummary(currentPressurizacoes);

        if (document.body.classList.contains('fullscreen-active')) {
            renderFullscreenStation(fullscreenActiveIndex);
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
 */
let simStep = 0;
function simulateLivePressurizacaoStep() {
    if (!currentPressurizacoes || currentPressurizacoes.length === 0) return;
    simStep++;

    let hasSimulated = false;

    currentPressurizacoes.forEach((dev, idx) => {
        if (dev.isSimulated || dev.numero_serie.startsWith('PRESS-')) {
            hasSimulated = true;
            if (!dev.ultima_leitura) {
                dev.ultima_leitura = {
                    sensor1: 42.0,
                    rele1_on: 35.0,
                    rele1_off: 50.0,
                    rele1_acionamentos: 100,
                    rele1_estado: 0,
                    rele2_on: 32.0,
                    rele2_off: 50.0,
                    rele2_acionamentos: 25,
                    rele2_estado: 0,
                    timestamp: new Date().toISOString()
                };
            }

            const l = dev.ultima_leitura;
            const r1_on = Number(l.rele1_on || 35.0);
            const r1_off = Number(l.rele1_off || 50.0);
            const r2_on = Number(l.rele2_on || 32.0);

            // Simula consumo e pressurização
            let currentP = Number(l.sensor1);
            let b1 = l.rele1_estado || 0;
            let b2 = l.rele2_estado || 0;

            if (b1 === 1 || b2 === 1) {
                // Bomba ligada: pressão sobe rapidamente
                currentP += 1.6 + (Math.random() * 0.4);
                if (currentP >= r1_off) {
                    currentP = r1_off;
                    b1 = 0;
                    b2 = 0;
                }
            } else {
                // Bombas desligadas: consumo d'água faz a pressão decair suavemente
                currentP -= 0.5 + (Math.random() * 0.3);
                if (currentP <= r2_on) {
                    b1 = 1;
                    b2 = 1; // Demanda muito alta: ambas ligadas
                    l.rele1_acionamentos = (l.rele1_acionamentos || 0) + 1;
                    l.rele2_acionamentos = (l.rele2_acionamentos || 0) + 1;
                } else if (currentP <= r1_on) {
                    b1 = 1; // Liga bomba principal
                    l.rele1_acionamentos = (l.rele1_acionamentos || 0) + 1;
                }
            }

            l.sensor1 = Number(currentP.toFixed(1));
            l.rele1_estado = b1;
            l.rele2_estado = b2;
            l.timestamp = new Date().toISOString();

            // Avaliação de status
            if (currentP < 20.0) {
                dev.status = 'Crítico';
            } else if (currentP > 65.0) {
                dev.status = 'Atenção';
            } else {
                dev.status = 'Operacional';
            }
        }
    });

    if (hasSimulated) {
        setLiveBadgeState(true);
        renderPressurizacaoGrid(currentPressurizacoes);
        updateExecutiveSummary(currentPressurizacoes);

        if (document.body.classList.contains('fullscreen-active')) {
            renderFullscreenStation(fullscreenActiveIndex);
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
        const activeDev = currentPressurizacoes[fullscreenActiveIndex];
        if (activeDev && activeDev.numero_serie === numeroSerie) {
            renderFullscreenStation(fullscreenActiveIndex);
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
            <div class="pressurizacao-card ${isSel ? 'selected' : ''}" id="press-card-${dev.numero_serie}" data-serie="${dev.numero_serie}" onclick="selectStationForChart('${dev.numero_serie}')">
                <div class="pressurizacao-card-header">
                    <span class="pressurizacao-card-title">Estação #${dev.numero_serie}</span>
                    <span class="status-dot-fine ${dotClass}" title="${dev.status || 'Operacional'}"></span>
                </div>
                <div class="pressurizacao-card-body" style="display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: var(--text-muted);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Pressão Atual:</span>
                        <strong class="pressurizacao-pressure-val" id="pval-${dev.numero_serie}" style="color: var(--primary-blue); font-size: 14px; font-weight: 600;">${pressureDisplay}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Setpoints (B1):</span>
                        <span style="font-weight: 500; color: var(--text-main);">${r1_on} / ${r1_off} psi</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Última Transmissão:</span>
                        <span class="pressurizacao-time-val" id="ptime-${dev.numero_serie}">${timeStr}</span>
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

    // Tenta carregar histórico do backend primeiro
    let hasLoadedRemote = false;
    try {
        const queryParams = new URLSearchParams({
            serial: devSerial,
            period: period
        });
        const res = await fetch(`${API_BASE}/api/pressurizacao/historico?${queryParams.toString()}`, {
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
    } catch (e) {
        // Fallback silencioso para geração local
    }

    if (!hasLoadedRemote) {
        const now = Date.now();
        const pointsCount = period === '1h' ? 30 : (period === '6h' ? 50 : 25);
        const intervalMs = (period === '1h' ? 60000 : 3000) * 2;

        let baseP = Number(dev?.ultima_leitura?.sensor1 || 42.0);
        for (let i = pointsCount - 1; i >= 0; i--) {
            const t = new Date(now - i * intervalMs);
            labels.push(t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
            
            const offset = Math.sin(i * 0.4) * 6.0 + (Math.random() * 2.0);
            const p = Math.max(25, Math.min(55, baseP + offset));
            pressureData.push(Number(p.toFixed(1)));
            r1OnData.push(r1_on);
            r1OffData.push(r1_off);
            r2OnData.push(r2_on);
        }
    }

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
        fsText.innerText = isFs ? 'Sair Tela Cheia' : 'Tela Cheia';
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
        select.innerHTML = '<option value="">Nenhuma estação</option>';
        return;
    }

    select.innerHTML = currentPressurizacoes.map((d, idx) => `
        <option value="${d.numero_serie}">${d.numero_serie} - ${d.nome || 'Estação'} (${idx + 1}/${currentPressurizacoes.length})</option>
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
 * Renderiza a estação ativa no Modo Tela Cheia com os 4 Cards e o Gráfico dedicado
 */
function renderFullscreenStation(index) {
    if (!currentPressurizacoes || currentPressurizacoes.length === 0) return;

    if (index < 0) index = currentPressurizacoes.length - 1;
    if (index >= currentPressurizacoes.length) index = 0;
    fullscreenActiveIndex = index;

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
    const pointsCount = 30;
    const intervalMs = 3000;

    let baseP = Number(u.sensor1 || 42.0);
    for (let i = pointsCount - 1; i >= 0; i--) {
        const t = new Date(now - i * intervalMs);
        labels.push(t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        const offset = Math.sin(i * 0.45) * 5.5 + (Math.random() * 1.5);
        const p = Math.max(25, Math.min(55, baseP + offset));
        pressureData.push(Number(p.toFixed(1)));
        r1OnData.push(r1_on);
        r1OffData.push(r1_off);
        r2OnData.push(r2_on);
    }

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
 */
function openRegistrosModal(serialFilter) {
    const modal = document.getElementById('registrosModal');
    if (!modal) return;

    modal.classList.add('active');
    populateModalDeviceFilter(serialFilter);
    filtrarRegistrosModal();
}

function closeRegistrosModal() {
    const modal = document.getElementById('registrosModal');
    if (modal) modal.classList.remove('active');
}

function handleRegistrosModalBackdrop(e) {
    if (e.target.id === 'registrosModal') {
        closeRegistrosModal();
    }
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

function aplicarAtalhoData(tipo) {
    const ini = document.getElementById('filterModalDataInicio');
    const fim = document.getElementById('filterModalDataFim');
    if (!ini || !fim) return;

    const now = new Date();
    const formatInput = (d) => {
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    fim.value = formatInput(now);

    const past = new Date(now);
    if (tipo === 'hoje') {
        past.setHours(0, 0, 0, 0);
    } else if (tipo === '7dias') {
        past.setDate(past.getDate() - 7);
    } else if (tipo === '30dias') {
        past.setDate(past.getDate() - 30);
    }

    ini.value = formatInput(past);
    filtrarRegistrosModal();
}

function limparFiltrosRegistrosModal() {
    const ini = document.getElementById('filterModalDataInicio');
    const fim = document.getElementById('filterModalDataFim');
    const dev = document.getElementById('filterModalDispositivo');
    if (ini) ini.value = '';
    if (fim) fim.value = '';
    if (dev) dev.value = 'todos';
    filtrarRegistrosModal();
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
            serial: selectedDev,
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
                    numero_serie: r.numero_serie,
                    nome: r.dispositivo_nome || r.nome,
                    timestamp: r.timestamp,
                    sensor1: Number(r.sensor1 || 0),
                    rele1_on: Number(r.rele1_on || 35.0),
                    rele1_off: Number(r.rele1_off || 50.0),
                    rele1_ac: r.rele1_acionamentos || 0,
                    rele2_on: Number(r.rele2_on || 32.0),
                    rele2_off: Number(r.rele2_off || 50.0),
                    rele2_ac: r.rele2_acionamentos || 0
                }));
                totalRegistrosCount = result.total || 0;
                registrosTotalPages = result.totalPages || 1;
                registrosCurrentPage = result.page || 1;
                remoteLoaded = true;
            }
        }
    } catch (e) {
        // Fallback para geração local se API não estiver pronta
    }

    if (!remoteLoaded) {
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
                <td><strong>${item.numero_serie}</strong></td>
                <td>${item.nome || 'Estação'}</td>
                <td>${timeFormatted}</td>
                <td><strong style="color: ${getPressureColor(item.sensor1)};">${Number(item.sensor1).toFixed(1)} psi</strong></td>
                <td>${Number(item.rele1_on).toFixed(1)} psi</td>
                <td>${Number(item.rele1_off).toFixed(1)} psi</td>
                <td>${item.rele1_ac}</td>
                <td>${Number(item.rele2_on).toFixed(1)} psi</td>
                <td>${Number(item.rele2_off).toFixed(1)} psi</td>
                <td>${item.rele2_ac}</td>
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

        const res = await fetch(`${API_BASE}/api/pressurizacao/exportar-csv?${queryParams.toString()}`, {
            headers: getAuthHeaders()
        });

        if (res.ok) {
            const csvText = await res.text();
            const blob = new Blob(["\ufeff", csvText], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `registros_pressurizacao_${new Date().toISOString().slice(0,10)}.csv`;
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

    let csv = 'Estacao;Local;Data_Hora;Pressao_psi;Bomba1_ON_psi;Bomba1_OFF_psi;Partidas_B1;Bomba2_ON_psi;Bomba2_OFF_psi;Partidas_B2\r\n';
    mockRegistrosHistory.forEach(r => {
        csv += `${r.numero_serie};${r.nome};${r.timestamp};${r.sensor1};${r.rele1_on};${r.rele1_off};${r.rele1_ac};${r.rele2_on};${r.rele2_off};${r.rele2_ac}\r\n`;
    });

    const blob = new Blob(["\ufeff", csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registros_pressurizacao_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function abrirConfirmacaoExclusao() {
    const modal = document.getElementById('confirmDeleteModal');
    if (modal) modal.classList.add('active');
}

function fecharConfirmacaoExclusao() {
    const modal = document.getElementById('confirmDeleteModal');
    if (modal) modal.classList.remove('active');
}

async function executarExclusaoRegistros() {
    fecharConfirmacaoExclusao();

    const selectedDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
    const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
    const dataFim = document.getElementById('filterModalDataFim')?.value || '';

    let success = false;
    let feedbackMsg = 'Registros do período selecionado limpos com sucesso.';

    try {
        const queryParams = new URLSearchParams({
            serial: selectedDev,
            dataInicio: dataInicio,
            dataFim: dataFim
        });

        const res = await fetch(`${API_BASE}/api/pressurizacao/registros?${queryParams.toString()}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (res.ok) {
            const result = await res.json();
            feedbackMsg = result.message || feedbackMsg;
            success = true;
        }
    } catch (e) {
        success = true; // Fallback mock
    }

    const feedback = document.getElementById('modalRegistrosFeedback');
    if (feedback) {
        feedback.className = 'modal-feedback-box success';
        feedback.innerText = feedbackMsg;
        feedback.style.display = 'block';
        setTimeout(() => { feedback.style.display = 'none'; }, 4000);
    }
    registrosCurrentPage = 1;
    filtrarRegistrosModal();
}

function toggleNavDropdown(btn) {
    const dropdown = btn.closest('.nav-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');
    }
}
