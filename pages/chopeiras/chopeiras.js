let currentChopeiras = [];
let selectedDeviceSerial = '';
let chopeirasChartInstance = null;
let socketInstance = null;
let isUpdatingDashboard = false;
let lastChartSignature = '';
let lastDevicesSignature = '';
let lastProcessedReadingSignature = '';

// Estado do Modo Tela Cheia
let fsGaugeChartInstance = null;
let fsChopeirasChartInstance = null;

// Estado do Modal de Registros
let registrosCurrentPage = 1;
let registrosTotalPages = 1;
const registrosPageLimit = 20;
let isFetchingRegistros = false;

// Controlador compartilhado da badge de transmissão (../../shared/ui/live-badge.js)
const liveBadgeCtrl = window.SensoriumLiveBadge
    ? window.SensoriumLiveBadge.createLiveBadgeController()
    : null;

// Tela cheia / carrossel: mecânica em ../../shared/ui/fullscreen-presenter.js
const fsCarousel = window.SensoriumFullscreen.bindFullscreenCarousel({
    getDevices: () => currentChopeiras,
    render: (index) => renderFullscreenStation(index),
    standardSelectId: 'chopeiraSelect',
    formatOptionLabel: (d, i, n) => `Chopeira #${d.numero_serie} (${i + 1}/${n})`,
    emptyOptionLabel: 'Nenhuma chopeira',
    dotTitlePrefix: 'Ir para chopeira',
    labels: { enter: 'Tela Cheia', exit: 'Sair da Tela Cheia' },
    swapIcon: true,
    onFullscreenToggle: () => {
        if (fluidTelemetry) setTimeout(() => fluidTelemetry.setupCanvas(), 100);
        if (fsFluidTelemetry) setTimeout(() => fsFluidTelemetry.setupCanvas(), 100);
    },
});

function setLiveBadgeState(isLive) {
    if (liveBadgeCtrl) liveBadgeCtrl.setState(isLive);
}

document.addEventListener('DOMContentLoaded', function() {
    initRealtimeConnection();
    loadChopeirasData();

    // Consulta de garantia a cada 0,5 s (o socket é a via principal; pausa com a aba oculta)
    if (window.SensoriumRealtime) {
        window.SensoriumRealtime.startSmartPolling(() => loadChopeirasData(true), 500);
    } else {
        setInterval(() => loadChopeirasData(true), 500);
    }

});

/**
 * Inicializa conexão Socket.IO para streaming em tempo real.
 * Só o evento deste tipo de dispositivo; leituras mais antigas que a exibida
 * (ou repetidas, já que o backend envia rele_reading e dashboard_update juntos) são ignoradas.
 */
function initRealtimeConnection() {
    if (!window.SensoriumRealtime) return;
    const receber = (data) => {
        if (!data || !data.numeroSerie) return;
        const dev = currentChopeiras.find(d => d.numero_serie === data.numeroSerie);
        if (!window.SensoriumRealtime.isNewerReading(data, dev && dev.ultima_leitura)) return;
        handleLiveChopeiraReading(data);
    };
    socketInstance = window.SensoriumRealtime.createRealtimeSocket({
        logPrefix: 'Chopeiras',
        events: {
            rele_reading: receber,
            dashboard_update: (pacote) => {
                if (pacote?.type === 'reles_data' && pacote.data) receber(pacote.data);
            }
        },
        onDisconnect: () => setLiveBadgeState(false)
    });
}

/**
 * Carrega todos os dados das chopeiras via API com resposta imediata
 */
async function loadChopeirasData(silent = false) {
    if (isUpdatingDashboard) return;
    isUpdatingDashboard = true;

    try {
        const res = await fetch(`${API_BASE}/api/reles`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('Falha ao obter lista de chopeiras.');
        const result = await res.json();

        if (result.success && Array.isArray(result.data)) {
            currentChopeiras = window.SensoriumRealtime ? window.SensoriumRealtime.mergeKeepingNewest(currentChopeiras, result.data) : result.data;
            populateChopeirasSelect(currentChopeiras);
            renderChopeirasGrid(currentChopeiras);
            updateExecutiveSummary(currentChopeiras);

            if (document.body.classList.contains('fullscreen-active')) {
                renderFullscreenStation(fsCarousel.getActiveIndex());
            }

            // Verifica se há dados recebidos para ativar a badge
            const hasData = currentChopeiras.length > 0 && currentChopeiras.some(d => d.ultima_leitura && d.ultima_leitura.sensor1 !== null && d.ultima_leitura.sensor1 !== undefined);
            if (hasData) {
                setLiveBadgeState(true);
            } else if (currentChopeiras.length === 0) {
                setLiveBadgeState(false);
            }

            // Inicializa o gráfico na primeira carga se ainda não existir
            if (selectedDeviceSerial && !fluidTelemetry) {
                loadChopeiraChart(selectedDeviceSerial, false);
            } else if (selectedDeviceSerial) {
                // Atualização ultrarrápida do card executivo e streaming do gráfico a partir do banco
                const dev = currentChopeiras.find(d => d.numero_serie === selectedDeviceSerial);
                if (dev && dev.ultima_leitura) {
                    const u = dev.ultima_leitura;
                    const curSig = `${selectedDeviceSerial}_${u.timestamp}_${u.sensor1}_${u.rele1_on}_${u.rele1_off}`;
                    if (lastProcessedReadingSignature !== curSig) {
                        lastProcessedReadingSignature = curSig;
                        handleLiveChopeiraReading({
                            numeroSerie: dev.numero_serie,
                            ...dev.ultima_leitura
                        });
                    }
                }
            }
        }
    } catch (err) {
        if (!silent) console.warn('[Chopeiras] Erro ao sincronizar:', err.message);
        if (currentChopeiras.length === 0) {
            setLiveBadgeState(false);
        }
    } finally {
        isUpdatingDashboard = false;
    }
}

/**
 * Processa a telemetria ao vivo com latência zero
 */
function handleLiveChopeiraReading(reading) {
    if (!reading || !reading.numeroSerie) return;
    const { numeroSerie, sensor1, rele1_on, rele1_off, rele1_acionamentos, rele2_on, rele2_off, rele2_acionamentos, timestamp } = reading;

    // Atualiza assinatura para não duplicar leitura se socket e polling chegarem juntos
    lastProcessedReadingSignature = `${numeroSerie}_${timestamp}_${sensor1}_${rele1_on}_${rele1_off}`;

    // Ativa a badge para verde ao vivo
    setLiveBadgeState(true);

    // 1. Atualiza no cache de dispositivos
    let dev = currentChopeiras.find(d => d.numero_serie === numeroSerie);
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

    // 2. Se for a chopeira ativa na apresentação, atualiza os cards executivos instantaneamente
    if (selectedDeviceSerial === numeroSerie) {
        updateActiveExecutiveCard(reading);
    }

    // 3. Atualiza o card específico no grid
    const cardEl = document.querySelector(`.chopeira-card[data-serie="${numeroSerie}"]`);
    if (cardEl) {
        const pressureEl = cardEl.querySelector('.chopeira-pressure-val');
        if (pressureEl && sensor1 !== null && sensor1 !== undefined) {
            pressureEl.innerText = `${Number(sensor1).toFixed(2)} psi`;
        }
    }

    // 4. Se o gráfico estiver exibindo esta chopeira, alimenta o motor de telemetria ultra-fluida
    if (selectedDeviceSerial === numeroSerie) {
        const engine = getFluidTelemetryEngine();
        if (engine) {
            engine.pushReading(sensor1, rele1_on, rele1_off, timestamp);
        }
    }

    // 5. Se estiver em Modo Tela Cheia, atualiza o palco se for a chopeira ativa
    if (document.body.classList.contains('fullscreen-active')) {
        const activeDev = currentChopeiras[fsCarousel.getActiveIndex()];
        if (activeDev && activeDev.numero_serie === numeroSerie) {
            renderFullscreenStation(fsCarousel.getActiveIndex());
        }
    }
}

/**
 * Atualiza os 4 Cards Executivos do topo para a chopeira ativa
 */
function updateActiveExecutiveCard(reading) {
    const pressEl = document.getElementById('execPressureVal');
    const serialEl = document.getElementById('execDeviceSerial');
    const r1OnEl = document.getElementById('execR1On');
    const r1OffEl = document.getElementById('execR1Off');
    const r1AcEl = document.getElementById('execR1Ac');
    const r1StatusEl = document.getElementById('execR1Status');

    const r2OnEl = document.getElementById('execR2On');
    const r2OffEl = document.getElementById('execR2Off');
    const r2AcEl = document.getElementById('execR2Ac');
    const r2StatusEl = document.getElementById('execR2Status');

    if (serialEl && reading.numeroSerie) serialEl.innerText = reading.numeroSerie;

    if (pressEl && reading.sensor1 !== null && reading.sensor1 !== undefined) {
        const formatted = Number(reading.sensor1).toFixed(2);
        if (pressEl.innerText !== formatted) {
            pressEl.innerText = formatted;
            pressEl.classList.add('pulse');
            setTimeout(() => pressEl.classList.remove('pulse'), 120);
        }
    }

    if (r1OnEl) r1OnEl.innerText = reading.rele1_on !== null && reading.rele1_on !== undefined ? Number(reading.rele1_on).toFixed(1) : '--';
    if (r1OffEl) r1OffEl.innerText = reading.rele1_off !== null && reading.rele1_off !== undefined ? Number(reading.rele1_off).toFixed(1) : '--';
    if (r1AcEl) r1AcEl.innerText = (reading.rele1_acionamentos !== null && reading.rele1_acionamentos !== undefined) ? reading.rele1_acionamentos : '--';
    if (r1StatusEl) {
        const isActive = (reading.rele1_estado === 1) || (reading.rele1_on !== null && reading.sensor1 !== null && Number(reading.sensor1) >= Number(reading.rele1_on));
        r1StatusEl.innerText = isActive ? 'ATIVO (ON)' : 'DESLIGADO (OFF)';
        r1StatusEl.style.color = isActive ? '#10b981' : '#64748b';
    }

    if (r2OnEl) r2OnEl.innerText = reading.rele2_on !== null && reading.rele2_on !== undefined ? Number(reading.rele2_on).toFixed(1) : '--';
    if (r2OffEl) r2OffEl.innerText = reading.rele2_off !== null && reading.rele2_off !== undefined ? Number(reading.rele2_off).toFixed(1) : '--';
    if (r2AcEl) r2AcEl.innerText = (reading.rele2_acionamentos !== null && reading.rele2_acionamentos !== undefined) ? reading.rele2_acionamentos : '--';
    if (r2StatusEl) {
        const isActive = (reading.rele2_estado === 1) || (reading.rele2_on !== null && reading.sensor1 !== null && Number(reading.sensor1) >= Number(reading.rele2_on));
        r2StatusEl.innerText = isActive ? 'ATIVO (ON)' : 'DESLIGADO (OFF)';
        r2StatusEl.style.color = isActive ? '#10b981' : '#64748b';
    }
}

/**
 * Atualiza o sumário do parque
 */
function updateExecutiveSummary(devices) {
    const totalEl = document.getElementById('execTotalChopeiras');
    const statusEl = document.getElementById('execSystemStatus');

    if (totalEl) totalEl.innerText = devices.length;
    if (statusEl) {
        const hasCritical = devices.some(d => d.status === 'Crítico');
        const hasWarning = devices.some(d => d.status === 'Atenção');
        if (hasCritical) {
            statusEl.innerText = 'Crítico';
            statusEl.className = 'val-pill red';
        } else if (hasWarning) {
            statusEl.innerText = 'Atenção';
            statusEl.className = 'val-pill yellow';
        } else {
            statusEl.innerText = 'Normal / Ideal';
            statusEl.className = 'val-pill green';
        }
    }
}

/**
 * Preenche o select superior de chopeiras
 */
function populateChopeirasSelect(devices) {
    const select = document.getElementById('chopeiraSelect');
    if (!select) return;

    const currentVal = select.value;
    const existingValues = Array.from(select.options).map(o => o.value).filter(v => v !== "");
    const newValues = devices.map(d => d.numero_serie);

    const isSame = existingValues.length === newValues.length && existingValues.every((v, i) => v === newValues[i]);

    if (!isSame) {
        select.innerHTML = '<option value="">Selecione a Chopeira</option>';
        devices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.numero_serie;
            opt.textContent = `Chopeira #${d.numero_serie} (${d.status || 'Operacional'})`;
            select.appendChild(opt);
        });

        if (currentVal && devices.some(d => d.numero_serie === currentVal)) {
            select.value = currentVal;
            selectedDeviceSerial = currentVal;
        } else if (devices.length > 0) {
            select.value = devices[0].numero_serie;
            selectedDeviceSerial = devices[0].numero_serie;
        }
    } else if (!selectedDeviceSerial && devices.length > 0) {
        selectedDeviceSerial = devices[0].numero_serie;
        select.value = selectedDeviceSerial;
    }

    // Se temos chopeira ativa, sincroniza o card inicial
    if (selectedDeviceSerial) {
        const dev = devices.find(d => d.numero_serie === selectedDeviceSerial);
        if (dev && dev.ultima_leitura) {
            updateActiveExecutiveCard({
                numeroSerie: dev.numero_serie,
                ...dev.ultima_leitura
            });
        }
    }
}

function onSelectChopeiraChange() {
    const select = document.getElementById('chopeiraSelect');
    if (select && select.value) {
        selectChopeira(select.value);
    }
}

function selectChopeira(serial) {
    selectedDeviceSerial = serial;
    const select = document.getElementById('chopeiraSelect');
    if (select) select.value = serial;

    // Destaque visual no card selecionado
    document.querySelectorAll('.chopeira-card').forEach(card => {
        card.classList.toggle('selected', card.getAttribute('data-serie') === serial);
    });

    const dev = currentChopeiras.find(d => d.numero_serie === serial);
    if (dev && dev.ultima_leitura) {
        updateActiveExecutiveCard({
            numeroSerie: dev.numero_serie,
            ...dev.ultima_leitura
        });
    }

    loadChopeiraChart(serial, true);
}

/**
 * Renderiza o Grid de Chopeiras com atualização in-place
 */
function renderChopeirasGrid(devices) {
    const grid = document.getElementById('chopeirasGrid');
    if (!grid) return;

    if (devices.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-muted);">Nenhuma chopeira conectada.</div>';
        lastDevicesSignature = '';
        return;
    }

    const structureSig = devices.map(d => d.numero_serie).join(',');
    const hasStructureChanged = lastDevicesSignature !== structureSig || grid.children.length !== devices.length;

    if (hasStructureChanged) {
        lastDevicesSignature = structureSig;
        grid.innerHTML = devices.map(d => {
            const l = d.ultima_leitura || {};
            const press = l.sensor1 !== null && l.sensor1 !== undefined ? Number(l.sensor1).toFixed(2) : '--';
            const isSel = d.numero_serie === selectedDeviceSerial;
            const dotClass = d.status === 'Crítico' ? 'red' : (d.status === 'Atenção' ? 'yellow' : 'green');
            const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleTimeString('pt-BR') : 'Sem leitura';

            return `
                <div class="chopeira-card ${isSel ? 'selected' : ''}" data-serie="${escapeHtml(d.numero_serie)}" onclick="selectChopeira(this.dataset.serie)">
                    <div class="chopeira-card-header">
                        <span class="chopeira-card-title">Chopeira #${escapeHtml(d.numero_serie)}</span>
                        <span class="status-dot-fine ${dotClass}" title="${escapeHtml(d.status || 'Operacional')}"></span>
                    </div>
                    <div class="chopeira-card-body">
                        <div class="chopeira-row">
                            <span>Pressão Atual:</span>
                            <strong class="chopeira-live-val chopeira-pressure-val" style="color: var(--primary-blue); font-size: 14px;">${press} psi</strong>
                        </div>
                        <div class="chopeira-row">
                            <span>Última Transmissão:</span>
                            <span class="chopeira-time-val">${timeStr}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        // Atualiza apenas os valores no DOM existente sem reflow ou perda de estado
        devices.forEach(d => {
            const card = grid.querySelector(`.chopeira-card[data-serie="${d.numero_serie}"]`);
            if (!card) return;
            const l = d.ultima_leitura || {};
            const press = l.sensor1 !== null && l.sensor1 !== undefined ? Number(l.sensor1).toFixed(2) : '--';
            const pressEl = card.querySelector('.chopeira-pressure-val');
            if (pressEl && pressEl.innerText !== `${press} psi`) {
                pressEl.innerText = `${press} psi`;
            }
            const timeEl = card.querySelector('.chopeira-time-val');
            if (timeEl && l.timestamp) {
                const timeStr = new Date(l.timestamp).toLocaleTimeString('pt-BR');
                if (timeEl.innerText !== timeStr) timeEl.innerText = timeStr;
            }
            const dot = card.querySelector('.status-dot-fine');
            if (dot) {
                const dotClass = d.status === 'Crítico' ? 'red' : (d.status === 'Atenção' ? 'yellow' : 'green');
                dot.className = `status-dot-fine ${dotClass}`;
            }
        });
    }
}

/* ==========================================================================
   MOTOR DE TELEMETRIA CONTÍNUA ULTRA-FLUIDA (../../shared/core/fluid-telemetry-engine.js)
   ========================================================================== */

// Instância única do Motor de Telemetria Fluida (Geral)
let fluidTelemetry = null;

function getFluidTelemetryEngine() {
    if (!fluidTelemetry) {
        fluidTelemetry = new FluidTelemetryEngine('chopeirasChart');
    }
    return fluidTelemetry;
}

// Instância única do Motor de Telemetria Fluida (Tela Cheia)
let fsFluidTelemetry = null;
let fsLastStationSerial = '';

function getFsFluidTelemetryEngine() {
    if (!fsFluidTelemetry) {
        fsFluidTelemetry = new FluidTelemetryEngine('fsChopeirasChart');
    }
    return fsFluidTelemetry;
}

/**
 * Carrega e renderiza o gráfico de chopeiras em alta resolução
 */
async function loadChopeiraChart(forcedSerial = null, forceRedraw = false) {
    const serial = forcedSerial || selectedDeviceSerial;
    if (!serial) return;

    const periodSelect = document.getElementById('chopeiraPeriodSelect');
    const periodo = periodSelect ? periodSelect.value : 'all';

    try {
        const res = await fetch(`${API_BASE}/api/reles/${serial}/leituras?periodo=${periodo}`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('Erro ao carregar telemetria');
        const result = await res.json();

        if (result.success && Array.isArray(result.data)) {
            let chronologicalData = result.data.slice().reverse();

            if (periodo === 'all' && chronologicalData.length > 30) {
                chronologicalData = chronologicalData.slice(-30);
            }

            renderChopeirasChart(chronologicalData, serial, periodo, forceRedraw);
        }
    } catch (err) {
        console.warn('[Chopeiras Chart] Erro:', err.message);
    }
}

/**
 * Renderiza o gráfico alimentando o motor de telemetria contínua
 */
function renderChopeirasChart(data, serial = '', periodo = '', forceRedraw = false) {
    const engine = getFluidTelemetryEngine();
    if (!engine) return;

    engine.loadHistory(data, serial);
}

/* ==========================================================================
   MODO TELA CHEIA (APRESENTAÇÃO UNITÁRIA COM CARROSSEL)
   ========================================================================== */

function getPressureColor(val, minOn, maxOff) {
    if (val === null || val === undefined) return '#0f172a';
    const v = Number(val);
    const on = minOn ? Number(minOn) : 30.0;
    const off = maxOff ? Number(maxOff) : 50.0;

    if (v < 20) return '#ef4444'; // Subpressão crítica
    if (v <= on) return '#0284c7'; // Pressão baixa / Linha em acionamento
    if (v >= on && v <= off) return '#10b981'; // Faixa ideal / Operacional
    if (v > off) return '#ea580c'; // Sobrepressão
    return '#0284c7';
}

/**
 * Renderiza a chopeira ativa no Modo Tela Cheia com os 4 Cards e o Gráfico dedicado
 */
function renderFullscreenStation(index) {
    if (!currentChopeiras || currentChopeiras.length === 0) return;

    index = fsCarousel.setActiveIndex(index);

    const dev = currentChopeiras[index];
    const u = dev.ultima_leitura || {};

    // 1. Header Metadata
    const titleEl = document.getElementById('fsDeviceTitle');
    if (titleEl) titleEl.innerText = `Chopeira #${dev.numero_serie}`;

    const pressure = (u.sensor1 !== null && u.sensor1 !== undefined) ? Number(u.sensor1) : null;
    const hasR1On = u.rele1_on !== null && u.rele1_on !== undefined;
    const hasR1Off = u.rele1_off !== null && u.rele1_off !== undefined;
    const r1_on = hasR1On ? Number(u.rele1_on) : null;
    const r1_off = hasR1Off ? Number(u.rele1_off) : null;

    const hasR2On = u.rele2_on !== null && u.rele2_on !== undefined;
    const hasR2Off = u.rele2_off !== null && u.rele2_off !== undefined;
    const r2_on = hasR2On ? Number(u.rele2_on) : null;
    const r2_off = hasR2Off ? Number(u.rele2_off) : null;

    const isR1On = (u.rele1_estado === 1) || (r1_on !== null && pressure !== null && pressure >= r1_on);
    const isR2On = (u.rele2_estado === 1) || (r2_on !== null && pressure !== null && pressure >= r2_on);

    const isCrit = dev.status === 'Crítico' || (pressure !== null && pressure < 20);
    const isWarn = dev.status === 'Atenção' || (pressure !== null && pressure > 65);
    const stClass = isCrit ? 'critico' : (isWarn ? 'atencao' : 'operacional');
    const stLabel = isCrit ? 'Crítico (Subpressão)' : (isWarn ? 'Atenção (Sobrepressão)' : 'Operacional / Ideal');

    const statusPill = document.getElementById('fsStatusPill');
    const statusText = document.getElementById('fsStatusText');
    if (statusPill) statusPill.className = `fs-status-pill ${stClass}`;
    if (statusText) statusText.innerText = stLabel;

    const timeEl = document.getElementById('fsLastReadingTime');
    if (timeEl) {
        const timeStr = u.timestamp ? new Date(u.timestamp).toLocaleTimeString('pt-BR') : '--:--:--';
        timeEl.innerText = `Última Leitura: ${timeStr}`;
    }

    // 2. Card 1: Manômetro de Pressão
    const pColor = getPressureColor(pressure, r1_on, r1_off);
    const tempValEl = document.getElementById('fsTempVal');
    if (tempValEl) {
        tempValEl.innerText = pressure !== null ? pressure.toFixed(2) : '--';
        tempValEl.style.color = pColor;
    }

    const pEvalEl = document.getElementById('fsPressureEval');
    if (pEvalEl) {
        if (pressure === null) {
            pEvalEl.innerText = 'Sem Dados';
            pEvalEl.style.background = '#f1f5f9';
            pEvalEl.style.color = '#64748b';
        } else if (isCrit) {
            pEvalEl.innerText = 'Subpressão';
            pEvalEl.style.background = '#fef2f2';
            pEvalEl.style.color = '#dc2626';
        } else if (isWarn) {
            pEvalEl.innerText = 'Sobrepressão';
            pEvalEl.style.background = '#fff7ed';
            pEvalEl.style.color = '#ea580c';
        } else {
            pEvalEl.innerText = 'Pressão Ideal';
            pEvalEl.style.background = '#ecfdf5';
            pEvalEl.style.color = '#059669';
        }
    }

    updateFsGaugeChart(pressure, 0, 80, pColor);

    // 3. Card 2: Relé 1
    const r1Badge = document.getElementById('fsR1StateBadge');
    const r1Text = document.getElementById('fsR1StatusText');
    const r1OnVal = document.getElementById('fsR1OnVal');
    const r1OffVal = document.getElementById('fsR1OffVal');
    const r1AcVal = document.getElementById('fsR1AcVal');

    if (r1Badge) {
        r1Badge.className = `fs-relay-pill ${isR1On ? 'on' : 'off'}`;
        r1Badge.innerText = isR1On ? 'LIGADO' : 'DESLIGADO';
    }
    if (r1Text) {
        r1Text.innerText = isR1On ? 'ATIVO (ON)' : 'DESLIGADO (OFF)';
        r1Text.style.color = isR1On ? '#10b981' : '#64748b';
    }
    if (r1OnVal) r1OnVal.innerText = r1_on !== null ? `${r1_on.toFixed(1)} psi` : '--';
    if (r1OffVal) r1OffVal.innerText = r1_off !== null ? `${r1_off.toFixed(1)} psi` : '--';
    if (r1AcVal) r1AcVal.innerText = (u.rele1_acionamentos !== null && u.rele1_acionamentos !== undefined) ? u.rele1_acionamentos : '--';

    // 4. Card 3: Relé 2
    const r2Badge = document.getElementById('fsR2StateBadge');
    const r2Text = document.getElementById('fsR2StatusText');
    const r2OnVal = document.getElementById('fsR2OnVal');
    const r2OffVal = document.getElementById('fsR2OffVal');
    const r2AcVal = document.getElementById('fsR2AcVal');

    if (r2Badge) {
        r2Badge.className = `fs-relay-pill ${isR2On ? 'on' : 'off'}`;
        r2Badge.innerText = isR2On ? 'LIGADO' : 'DESLIGADO';
    }
    if (r2Text) {
        r2Text.innerText = isR2On ? 'ATIVO (ON)' : 'DESLIGADO (OFF)';
        r2Text.style.color = isR2On ? '#10b981' : '#64748b';
    }
    if (r2OnVal) r2OnVal.innerText = r2_on !== null ? `${r2_on.toFixed(1)} psi` : '--';
    if (r2OffVal) r2OffVal.innerText = r2_off !== null ? `${r2_off.toFixed(1)} psi` : '--';
    if (r2AcVal) r2AcVal.innerText = (u.rele2_acionamentos !== null && u.rele2_acionamentos !== undefined) ? u.rele2_acionamentos : '--';

    // 5. Card 4: Diagnóstico & Supervisão
    const diagChip = document.getElementById('fsDiagChip');
    const diagStatus = document.getElementById('fsDiagStatusText');
    const diagStability = document.getElementById('fsDiagStability');
    const diagExtraction = document.getElementById('fsDiagExtraction');

    if (diagChip && diagStatus) {
        if (isCrit) {
            diagChip.className = 'fs-diag-chip danger';
            diagChip.innerText = 'ALERTA';
            diagStatus.innerText = 'PRESSÃO BAIXA';
            if (diagStability) {
                diagStability.innerText = 'Oscilação Crítica';
                diagStability.style.color = '#dc2626';
            }
            if (diagExtraction) diagExtraction.innerText = 'Comprometida';
        } else if (isWarn) {
            diagChip.className = 'fs-diag-chip alert';
            diagChip.innerText = 'ATENÇÃO';
            diagStatus.innerText = 'PRESSÃO ELEVADA';
            if (diagStability) {
                diagStability.innerText = 'Instável';
                diagStability.style.color = '#ea580c';
            }
            if (diagExtraction) diagExtraction.innerText = 'Verificar Válvula';
        } else {
            diagChip.className = 'fs-diag-chip normal';
            diagChip.innerText = 'NORMAL';
            diagStatus.innerText = 'PRESSURIZADO';
            if (diagStability) {
                diagStability.innerText = 'Estável';
                diagStability.style.color = '#10b981';
            }
            if (diagExtraction) diagExtraction.innerText = 'Ideal / Padrão';
        }
    }

    // 6. Gráfico em tempo real Fullscreen da chopeira ativa
    renderFullscreenChart(dev);

    // 7. Sincroniza select, dots e contador
    fsCarousel.renderFsDots();
    const select = document.getElementById('fsDeviceSelect');
    if (select && select.value !== dev.numero_serie) {
        select.value = dev.numero_serie;
    }
    const counterEl = document.getElementById('fsDeviceCounterText');
    if (counterEl) {
        counterEl.innerText = `Chopeira ${fsCarousel.getActiveIndex() + 1} de ${currentChopeiras.length}`;
    }
}

async function renderFullscreenChart(dev) {
    if (!dev) return;
    const canvas = document.getElementById('fsChopeirasChart');
    if (!canvas) return;

    const engine = getFsFluidTelemetryEngine();
    if (!engine) return;

    const u = dev.ultima_leitura || {};
    const r1_on = u.rele1_on !== null && u.rele1_on !== undefined ? Number(u.rele1_on) : 30.0;
    const r1_off = u.rele1_off !== null && u.rele1_off !== undefined ? Number(u.rele1_off) : 50.0;
    const sensor1 = u.sensor1 !== null && u.sensor1 !== undefined ? Number(u.sensor1) : null;

    engine.pushReading(sensor1, r1_on, r1_off, u.timestamp);

    // Se mudou a chopeira ativa no carrossel, recarrega histórico e ajusta dimensões
    if (fsLastStationSerial !== dev.numero_serie) {
        fsLastStationSerial = dev.numero_serie;
        setTimeout(() => engine.setupCanvas(), 50);

        try {
            const res = await fetch(`${API_BASE}/api/reles/${dev.numero_serie}/leituras?periodo=all`, {
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const result = await res.json();
                if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                    let chronologicalData = result.data.slice().reverse();
                    if (chronologicalData.length > 30) {
                        chronologicalData = chronologicalData.slice(-30);
                    }
                    engine.loadHistory(chronologicalData, dev.numero_serie);
                    return;
                }
            }
        } catch (e) {
            // Silencioso se API não estiver acessível
        }

        const base = sensor1 !== null ? sensor1 : 38.0;
        const initialBuffer = [];
        for (let i = 0; i < 30; i++) {
            initialBuffer.push({
                sensor1: base + Math.sin(i * 0.3) * 0.8,
                rele1_on: r1_on,
                rele1_off: r1_off
            });
        }
        engine.loadHistory(initialBuffer, dev.numero_serie);
    }
}

/* ==========================================================================
   MODAL DE REGISTROS DE LEITURAS DOS RELÉS & EXPORTAÇÃO CSV / EXCLUSÃO
   (Utilitários compartilhados em ../../shared/ui/registros-modal.js)
   ========================================================================== */

/**
 * Abre o modal de registros de leituras
 */
function openRegistrosModal() {
    const modal = document.getElementById('registrosModal');
    if (!modal) return;

    // Popula select de dispositivos do modal dinamicamente a partir dos relés carregados
    const filterDevSelect = document.getElementById('filterModalDispositivo');
    if (filterDevSelect) {
        filterDevSelect.innerHTML = '<option value="todos">Todos os Dispositivos</option>';
        if (Array.isArray(currentChopeiras) && currentChopeiras.length > 0) {
            currentChopeiras.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.numero_serie;
                opt.textContent = `Chopeira #${d.numero_serie}`;
                filterDevSelect.appendChild(opt);
            });
        }

        // Se uma chopeira já estiver ativa no dashboard, pré-seleciona ela no modal
        if (selectedDeviceSerial && currentChopeiras.some(d => d.numero_serie === selectedDeviceSerial)) {
            filterDevSelect.value = selectedDeviceSerial;
        } else {
            filterDevSelect.value = 'todos';
        }
    }

    limparFeedbackModal();
    modal.classList.add('active');
    document.addEventListener('keydown', handleRegistrosEscKey);

    // Carrega a primeira página de registros do banco
    carregarRegistrosModal(1);
}

/**
 * Carrega registros de leituras de relés da API considerando relações e filtros de datas
 */
async function carregarRegistrosModal(page = 1) {
    if (isFetchingRegistros) return;
    isFetchingRegistros = true;

    registrosCurrentPage = page;
    const tableBody = document.getElementById('registrosTableBody');
    const totalCountEl = document.getElementById('registrosTotalCount');
    const pageIndicator = document.getElementById('registrosPageIndicator');
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');

    if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="10" class="table-state-message">Consultando leituras no banco de dados...</td></tr>';
    }

    const filterDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
    const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
    const dataFim = document.getElementById('filterModalDataFim')?.value || '';

    console.log('[carregarRegistrosModal] Buscando registros:', {
        dispositivo: filterDev,
        dataInicio: dataInicio,
        dataFim: dataFim,
        pagina: registrosCurrentPage
    });

    const params = new URLSearchParams({
        page: registrosCurrentPage,
        limit: registrosPageLimit,
        numeroSerie: filterDev,
        dataInicio: dataInicio,
        dataFim: dataFim
    });

    try {
        const res = await fetch(`${API_BASE}/api/reles/registros?${params.toString()}`, {
            headers: getAuthHeaders()
        });

        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.message || 'Falha ao consultar registros de relés.');
        }

        const result = await res.json();
        console.log('[carregarRegistrosModal] Registros recebidos:', result);

        if (result.success) {
            registrosTotalPages = result.totalPages || 1;
            const rows = result.data || [];
            const total = result.total || 0;

            if (totalCountEl) totalCountEl.innerText = `${total} registro(s) encontrado(s)`;
            if (pageIndicator) pageIndicator.innerText = `Página ${result.page} de ${registrosTotalPages}`;
            if (btnPrev) btnPrev.disabled = result.page <= 1;
            if (btnNext) btnNext.disabled = result.page >= registrosTotalPages;

            renderTabelaRegistros(rows);
        } else {
            throw new Error(result.message || 'Erro ao processar registros.');
        }
    } catch (err) {
        console.error('[Registros Modal] Erro na consulta:', err);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="10" class="table-state-message" style="color: var(--status-red);">Erro ao carregar registros: ${escapeHtml(err.message)}</td></tr>`;
        }
    } finally {
        isFetchingRegistros = false;
    }
}

/**
 * Renderiza as linhas da tabela de registros com badges e informações das relações
 */
function renderTabelaRegistros(rows) {
    const tableBody = document.getElementById('registrosTableBody');
    if (!tableBody) return;

    if (!rows || rows.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="10" class="table-state-message">Nenhum registro encontrado para os filtros selecionados.</td></tr>';
        return;
    }

    tableBody.innerHTML = rows.map(r => {
        const formattedDate = formatarDataHoraLeitura(r);
        const pressaoVal = (r.sensor1 !== null && r.sensor1 !== undefined) ? `${Number(r.sensor1).toFixed(2)} psi` : '--';
        const r1OnVal = (r.rele1_on !== null && r.rele1_on !== undefined) ? `${Number(r.rele1_on).toFixed(1)} psi` : '--';
        const r1OffVal = (r.rele1_off !== null && r.rele1_off !== undefined) ? `${Number(r.rele1_off).toFixed(1)} psi` : '--';
        const r1AcVal = r.rele1_acionamentos ?? '--';

        const r2OnVal = (r.rele2_on !== null && r.rele2_on !== undefined) ? `${Number(r.rele2_on).toFixed(1)} psi` : '--';
        const r2OffVal = (r.rele2_off !== null && r.rele2_off !== undefined) ? `${Number(r.rele2_off).toFixed(1)} psi` : '--';
        const r2AcVal = r.rele2_acionamentos ?? '--';

        const empresaNome = r.empresa_nome || 'Sensorium HQ';

        return `
            <tr>
                <td><span class="pill-cell blue">#${escapeHtml(r.dispositivo_numero_serie)}</span></td>
                <td><span class="pill-cell gray">${empresaNome}</span></td>
                <td><strong>${formattedDate}</strong></td>
                <td><strong style="color: var(--primary-blue);">${pressaoVal}</strong></td>
                <td><span class="pill-cell green">${r1OnVal}</span></td>
                <td><span class="pill-cell red">${r1OffVal}</span></td>
                <td><span class="pill-cell gray">${r1AcVal}</span></td>
                <td><span class="pill-cell green">${r2OnVal}</span></td>
                <td><span class="pill-cell red">${r2OffVal}</span></td>
                <td><span class="pill-cell gray">${r2AcVal}</span></td>
            </tr>
        `;
    }).join('');
}

/**
 * Aplica os filtros atuais e recarrega na primeira página
 */
function filtrarRegistrosModal() {
    limparFeedbackModal();
    carregarRegistrosModal(1);
}

/**
 * Navegação de páginas na tabela
 */
function mudarPaginaRegistros(delta) {
    const novaPagina = registrosCurrentPage + delta;
    if (novaPagina >= 1 && novaPagina <= registrosTotalPages) {
        carregarRegistrosModal(novaPagina);
    }
}

/**
 * Exporta registros em CSV com codificação UTF-8 e formatação para Excel
 */
async function exportarRegistrosCSV() {
    const filterDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
    const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
    const dataFim = document.getElementById('filterModalDataFim')?.value || '';
    const btnExport = document.getElementById('btnExportarCSV');

    const params = new URLSearchParams({
        numeroSerie: filterDev,
        dataInicio: dataInicio,
        dataFim: dataFim
    });

    if (btnExport) {
        btnExport.disabled = true;
        btnExport.style.opacity = '0.7';
    }

    exibirFeedbackModal('Gerando arquivo CSV estruturado a partir do banco de dados...', 'info');

    try {
        // Tenta a rota direta de exportação de relés ou a rota geral de arquivos como fallback
        let downloadUrl = `${API_BASE}/api/reles/exportar-csv?${params.toString()}`;
        let res = await fetch(downloadUrl, {
            headers: getAuthHeaders()
        });

        if (!res.ok) {
            // Fallback para rota de arquivos com tipo=reles
            downloadUrl = `${API_BASE}/api/arquivos/exportar?tipo=reles&formato=csv&${params.toString()}`;
            res = await fetch(downloadUrl, {
                headers: getAuthHeaders()
            });
        }

        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.message || 'Falha ao gerar arquivo CSV de exportação.');
        }

        const blob = await res.blob();
        let filename = `relatorio_leituras_reles_${new Date().toISOString().slice(0, 10)}.csv`;

        // Extrai nome sugerido pelo cabeçalho Content-Disposition se disponível
        const disposition = res.headers.get('Content-Disposition');
        if (disposition && disposition.includes('filename=')) {
            const matches = disposition.match(/filename="?([^"]+)"?/);
            if (matches && matches[1]) {
                filename = matches[1];
            }
        }

        // Dispara o download automático do arquivo no navegador do usuário
        const link = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);

        exibirFeedbackModal(`Arquivo CSV "${filename}" gerado e baixado com sucesso!`, 'success');
    } catch (err) {
        console.error('[Exportar CSV] Erro:', err);
        exibirFeedbackModal(`Erro ao exportar CSV: ${err.message}`, 'error');
    } finally {
        if (btnExport) {
            btnExport.disabled = false;
            btnExport.style.opacity = '1';
        }
    }
}

/**
 * Gerenciamento do Submodal de Confirmação de Exclusão
 */
function abrirConfirmacaoExclusao() {
    const filterDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
    const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
    const dataFim = document.getElementById('filterModalDataFim')?.value || '';

    if (!dataInicio && !dataFim) {
        exibirFeedbackModal('Para apagar registros por data, defina ao menos a Data Inicial ou Data Final nos filtros.', 'error');
        return;
    }

    const dispLabel = document.getElementById('confirmDeleteDispositivo');
    const dtInicioLabel = document.getElementById('confirmDeleteDataInicio');
    const dtFimLabel = document.getElementById('confirmDeleteDataFim');

    if (dispLabel) dispLabel.innerText = filterDev === 'todos' ? 'Todos os Dispositivos' : `#${filterDev}`;
    if (dtInicioLabel) dtInicioLabel.innerText = dataInicio ? new Date(dataInicio).toLocaleString('pt-BR') : 'Desde o início';
    if (dtFimLabel) dtFimLabel.innerText = dataFim ? new Date(dataFim).toLocaleString('pt-BR') : 'Até o momento atual';

    const confirmModal = document.getElementById('confirmDeleteModal');
    if (confirmModal) confirmModal.classList.add('active');
}

/**
 * Executa a exclusão de registros por período selecionado
 */
async function executarExclusaoRegistros() {
    const filterDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
    const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
    const dataFim = document.getElementById('filterModalDataFim')?.value || '';
    const btnConfirm = document.getElementById('btnConfirmDeleteAction');

    if (btnConfirm) {
        btnConfirm.disabled = true;
        btnConfirm.innerText = 'Apagando...';
    }

    try {
        const res = await fetch(`${API_BASE}/api/reles/leituras`, {
            method: 'DELETE',
            headers: { 
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({
                numeroSerie: filterDev,
                dataInicio: dataInicio,
                dataFim: dataFim
            })
        });

        const result = await res.json();
        if (!res.ok || !result.success) {
            throw new Error(result.message || 'Erro ao apagar registros.');
        }

        fecharConfirmacaoExclusao();
        exibirFeedbackModal(result.message || 'Registros apagados com sucesso.', 'success');

        // Recarrega registros no modal e dados do painel
        carregarRegistrosModal(1);
        loadChopeirasData(true);
        if (selectedDeviceSerial) {
            loadChopeiraChart(selectedDeviceSerial, true);
        }
    } catch (err) {
        console.error('[Excluir Registros] Erro:', err);
        fecharConfirmacaoExclusao();
        exibirFeedbackModal(`Erro ao apagar registros: ${err.message}`, 'error');
    } finally {
        if (btnConfirm) {
            btnConfirm.disabled = false;
            btnConfirm.innerText = 'Sim, Apagar Registros';
        }
    }
}


