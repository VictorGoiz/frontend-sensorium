let currentIncendios = [];
let selectedDeviceSerial = '';
let socketInstance = null;
let isUpdatingDashboard = false;
let lastDevicesSignature = '';
let lastProcessedReadingSignature = '';

// Fullscreen Presentation & Carousel State
let fsGaugeChartInstance = null;
let fsChartSerial = '';
let fsChartLoadedAt = 0;
const fsChartInstanceReady = () => !!fsIncendioChartInstance;
let fsIncendioChartInstance = null;

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
    getDevices: () => currentIncendios,
    render: (index) => renderFullscreenStation(index),
    standardSelectId: 'incendioSelect',
    formatOptionLabel: (d, i, n) => `${d.numero_serie} - ${d.nome || 'Central'} (${i + 1}/${n})`,
    emptyOptionLabel: 'Nenhuma central',
    dotTitlePrefix: 'Ir para central',
    labels: { enter: 'Tela Cheia', exit: 'Sair Tela Cheia' },
    swapIcon: false,
    onFullscreenToggle: () => {
        if (fluidTelemetry) setTimeout(() => fluidTelemetry.setupCanvas(), 100);
    },
});

function setLiveBadgeState(isLive) {
    if (liveBadgeCtrl) liveBadgeCtrl.setState(isLive);
}

document.addEventListener('DOMContentLoaded', function() {
    initRealtimeConnection();
    loadIncendioData();

    // Sincronização periódica inteligente da telemetria a cada 1.5s
    if (window.SensoriumRealtime) {
        window.SensoriumRealtime.startSmartPolling(() => loadIncendioData(true), 1500);
    } else {
        setInterval(() => loadIncendioData(true), 1500);
    }

});

/**
 * Inicializa conexão Socket.IO para streaming em tempo real.
 * Só o evento deste tipo de dispositivo; leituras mais antigas que a exibida
 * (ou repetidas, já que o backend envia incendio_reading e dashboard_update juntos) são ignoradas.
 */
function initRealtimeConnection() {
    if (!window.SensoriumRealtime) return;
    const receber = (data) => {
        if (!data || !data.numeroSerie) return;
        const dev = currentIncendios.find(d => d.numero_serie === data.numeroSerie);
        if (!window.SensoriumRealtime.isNewerReading(data, dev && dev.ultima_leitura)) return;
        handleLiveIncendioReading(data);
    };
    socketInstance = window.SensoriumRealtime.createRealtimeSocket({
        logPrefix: 'Incêndio',
        events: {
            incendio_reading: receber,
            dashboard_update: (pacote) => {
                if (pacote?.type === 'incendio_data' && pacote.data) receber(pacote.data);
            }
        },
        onDisconnect: () => setLiveBadgeState(false)
    });
}

/**
 * Carrega dados das centrais de incêndio via API
 */
async function loadIncendioData(silent = false) {
    if (isUpdatingDashboard) return;
    isUpdatingDashboard = true;

    try {
        let loadedData = null;

        try {
            const res = await fetch(`${API_BASE}/api/incendio`, {
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const result = await res.json();
                if (result.success && Array.isArray(result.data)) {
                    loadedData = result.data;
                }
            }
        } catch (apiErr) {
            if (!silent) console.warn('[Incêndio] Falha ao consultar API:', apiErr.message);
        }

        if (loadedData !== null) {
            currentIncendios = window.SensoriumRealtime ? window.SensoriumRealtime.mergeKeepingNewest(currentIncendios, loadedData) : loadedData;
        }

        populateIncendioSelect(currentIncendios);
        renderIncendioGrid(currentIncendios);
        updateExecutiveSummary(currentIncendios);

        if (document.body.classList.contains('fullscreen-active')) {
            renderFullscreenStation(fsCarousel.getActiveIndex());
        }

        const hasData = currentIncendios.length > 0 && currentIncendios.some(d => d.ultima_leitura && d.ultima_leitura.sensor1 !== null && d.ultima_leitura.sensor1 !== undefined);
        if (hasData) {
            setLiveBadgeState(true);
        } else if (currentIncendios.length === 0) {
            setLiveBadgeState(false);
        }

        if (selectedDeviceSerial && !fluidTelemetry) {
            loadIncendioChart(selectedDeviceSerial, false);
        } else if (selectedDeviceSerial) {
            const dev = currentIncendios.find(d => d.numero_serie === selectedDeviceSerial);
            if (dev && dev.ultima_leitura) {
                const u = dev.ultima_leitura;
                const curSig = `${selectedDeviceSerial}_${u.timestamp}_${u.sensor1}_${u.rele1_on}_${u.rele1_off}`;
                if (lastProcessedReadingSignature !== curSig) {
                    lastProcessedReadingSignature = curSig;
                    handleLiveIncendioReading({
                        numeroSerie: dev.numero_serie,
                        ...dev.ultima_leitura
                    });
                }
            }
        }
    } catch (err) {
        if (!silent) console.warn('[Incêndio] Erro ao sincronizar:', err.message);
        if (currentIncendios.length === 0) {
            setLiveBadgeState(false);
        }
    } finally {
        isUpdatingDashboard = false;
    }
}

/**
 * Processa a telemetria ao vivo com latência zero
 */
function handleLiveIncendioReading(reading) {
    if (!reading || !reading.numeroSerie) return;
    const { numeroSerie, sensor1, rele1_on, rele1_off, rele1_acionamentos, rele2_on, rele2_off, rele2_acionamentos, timestamp } = reading;

    lastProcessedReadingSignature = `${numeroSerie}_${timestamp}_${sensor1}_${rele1_on}_${rele1_off}`;
    setLiveBadgeState(true);

    let dev = currentIncendios.find(d => d.numero_serie === numeroSerie);
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
        updateActiveExecutiveCard(reading);
    }

    const cardEl = document.querySelector(`.incendio-card[data-serie="${numeroSerie}"]`);
    if (cardEl) {
        const pressureEl = cardEl.querySelector('.incendio-pressure-val');
        if (pressureEl && sensor1 !== null && sensor1 !== undefined) {
            pressureEl.innerText = `${Number(sensor1).toFixed(2)} psi`;
        }
    }

    if (selectedDeviceSerial === numeroSerie) {
        const engine = getFluidTelemetryEngine();
        if (engine) {
            engine.pushReading(sensor1, rele1_on, rele1_off, rele2_on, timestamp);
        }
    }

    if (document.body.classList.contains('fullscreen-active')) {
        const activeDev = currentIncendios[fsCarousel.getActiveIndex()];
        if (activeDev && activeDev.numero_serie === numeroSerie) {
            renderFullscreenStation(fsCarousel.getActiveIndex());
        }
    }
}

/**
 * Atualiza os 4 Cards Executivos do topo para a rede ativa
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

    if (serialEl && reading.numeroSerie) {
        const dev = currentIncendios.find(d => d.numero_serie === reading.numeroSerie);
        serialEl.innerText = dev?.nome ? `${reading.numeroSerie} (${dev.nome})` : reading.numeroSerie;
    }

    if (pressEl && reading.sensor1 !== null && reading.sensor1 !== undefined) {
        const formatted = Number(reading.sensor1).toFixed(2);
        if (pressEl.innerText !== formatted) {
            pressEl.innerText = formatted;
            pressEl.classList.add('pulse');
            setTimeout(() => pressEl.classList.remove('pulse'), 120);
        }
    }

    // Bomba Principal (Combate)
    if (r1OnEl) r1OnEl.innerText = reading.rele1_on !== null && reading.rele1_on !== undefined ? `${Number(reading.rele1_on).toFixed(1)} psi` : '--';
    if (r1OffEl) r1OffEl.innerText = reading.rele1_off !== null && reading.rele1_off !== undefined ? `${Number(reading.rele1_off).toFixed(1)} psi` : '--';
    if (r1AcEl) r1AcEl.innerText = reading.rele1_acionamentos ?? '--';
    if (r1StatusEl) {
        // Em rede de incêndio, a bomba dispara se a pressão cai ABAIXO do setpoint de partida
        const isBombaPrincipalAtiva = (reading.rele1_on !== null && reading.sensor1 !== null && reading.sensor1 <= reading.rele1_on);
        r1StatusEl.innerText = isBombaPrincipalAtiva ? 'EM OPERAÇÃO (ON)' : 'STANDBY (OFF)';
        r1StatusEl.style.color = isBombaPrincipalAtiva ? '#dc2626' : '#64748b';
    }

    // Bomba Jockey (Pressurização)
    if (r2OnEl) r2OnEl.innerText = reading.rele2_on !== null && reading.rele2_on !== undefined ? `${Number(reading.rele2_on).toFixed(1)} psi` : '--';
    if (r2OffEl) r2OffEl.innerText = reading.rele2_off !== null && reading.rele2_off !== undefined ? `${Number(reading.rele2_off).toFixed(1)} psi` : '--';
    if (r2AcEl) r2AcEl.innerText = reading.rele2_acionamentos ?? '--';
    if (r2StatusEl) {
        const isJockeyAtiva = (reading.rele2_on !== null && reading.sensor1 !== null && reading.sensor1 <= reading.rele2_on);
        r2StatusEl.innerText = isJockeyAtiva ? 'PRESSURIZANDO (ON)' : 'STANDBY (OFF)';
        r2StatusEl.style.color = isJockeyAtiva ? '#ea580c' : '#64748b';
    }
}

/**
 * Atualiza o sumário operacional geral
 */
function updateExecutiveSummary(devices) {
    const totalEl = document.getElementById('execTotalIncendio');
    const statusEl = document.getElementById('execSystemStatus');

    if (totalEl) totalEl.innerText = devices.length;
    if (statusEl) {
        const hasCritical = devices.some(d => d.status === 'Crítico');
        const hasWarning = devices.some(d => d.status === 'Atenção');
        if (hasCritical) {
            statusEl.innerText = 'Crítico / Disparo de Linha';
            statusEl.className = 'val-pill red';
        } else if (hasWarning) {
            statusEl.innerText = 'Atenção / Oscilação de Pressão';
            statusEl.className = 'val-pill yellow';
        } else {
            statusEl.innerText = 'Pressurizado / Normal';
            statusEl.className = 'val-pill green';
        }
    }
}

/**
 * Preenche o select superior de centrais de incêndio
 */
function populateIncendioSelect(devices) {
    const select = document.getElementById('incendioSelect');
    if (!select) return;

    const currentVal = select.value;
    const existingValues = Array.from(select.options).map(o => o.value).filter(v => v !== "");
    const newValues = devices.map(d => d.numero_serie);

    const isSame = existingValues.length === newValues.length && existingValues.every((v, i) => v === newValues[i]);

    if (!isSame) {
        select.innerHTML = '<option value="">Selecione a Central de Incêndio</option>';
        devices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.numero_serie;
            opt.textContent = `${d.numero_serie} - ${d.nome || 'Rede de Incêndio'} (${d.status || 'Normal'})`;
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

function onSelectIncendioChange() {
    const select = document.getElementById('incendioSelect');
    if (select && select.value) {
        selectIncendio(select.value);
    }
}

function selectIncendio(serial) {
    selectedDeviceSerial = serial;
    const select = document.getElementById('incendioSelect');
    if (select) select.value = serial;

    document.querySelectorAll('.incendio-card').forEach(card => {
        card.classList.toggle('selected', card.getAttribute('data-serie') === serial);
    });

    const dev = currentIncendios.find(d => d.numero_serie === serial);
    if (dev && dev.ultima_leitura) {
        updateActiveExecutiveCard({
            numeroSerie: dev.numero_serie,
            ...dev.ultima_leitura
        });
    }

    loadIncendioChart(serial, true);
}

/**
 * Renderiza o Grid de Centrais com atualização in-place
 */
function renderIncendioGrid(devices) {
    const grid = document.getElementById('incendioGrid');
    if (!grid) return;

    if (devices.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-muted);">Nenhuma rede de incêndio monitorada.</div>';
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
            const nomeStr = d.nome || `Central #${d.numero_serie}`;

            return `
                <div class="incendio-card ${isSel ? 'selected' : ''}" data-serie="${escapeHtml(d.numero_serie)}" onclick="selectIncendio(this.dataset.serie)">
                    <div class="incendio-card-header">
                        <span class="incendio-card-title">${nomeStr}</span>
                        <span class="status-dot-fine ${dotClass}" title="${escapeHtml(d.status || 'Normal')}"></span>
                    </div>
                    <div class="incendio-card-body">
                        <div class="incendio-row">
                            <span>Série / Identificador:</span>
                            <strong>${escapeHtml(d.numero_serie)}</strong>
                        </div>
                        <div class="incendio-row">
                            <span>Pressão Atual:</span>
                            <strong class="incendio-live-val incendio-pressure-val" style="color: var(--primary-blue); font-size: 14px;">${press} psi</strong>
                        </div>
                        <div class="incendio-row">
                            <span>Última Transmissão:</span>
                            <span class="incendio-time-val">${timeStr}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        devices.forEach(d => {
            const card = grid.querySelector(`.incendio-card[data-serie="${d.numero_serie}"]`);
            if (!card) return;
            const l = d.ultima_leitura || {};
            const press = l.sensor1 !== null && l.sensor1 !== undefined ? Number(l.sensor1).toFixed(2) : '--';
            const pressEl = card.querySelector('.incendio-pressure-val');
            if (pressEl && pressEl.innerText !== `${press} psi`) {
                pressEl.innerText = `${press} psi`;
            }
            const timeEl = card.querySelector('.incendio-time-val');
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
   MOTOR DE TELEMETRIA CONTÍNUA EM CANVAS (../../shared/core/fluid-telemetry-engine.js)
   ========================================================================== */

let fluidTelemetry = null;

function getFluidTelemetryEngine() {
    if (!fluidTelemetry) {
        fluidTelemetry = new IncendioTelemetryEngine('incendioChart');
    }
    return fluidTelemetry;
}

/**
 * Carrega histórico para o gráfico
 */
async function loadIncendioChart(forcedSerial = null, forceRedraw = false) {
    const serial = forcedSerial || selectedDeviceSerial;
    if (!serial) {
        renderIncendioChart([], '', '', forceRedraw);
        return;
    }

    const periodSelect = document.getElementById('incendioPeriodSelect');
    const periodo = periodSelect ? periodSelect.value : 'all';

    try {
        let chartData = [];
        try {
            const res = await fetch(`${API_BASE}/api/incendio/${serial}/leituras?periodo=${periodo}`, {
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const result = await res.json();
                if (result.success && Array.isArray(result.data)) {
                    chartData = result.data.slice().reverse();
                }
            }
        } catch (e) {
            console.warn('[Incêndio Chart] Falha ao consultar API:', e.message);
        }

        if (periodo === 'all' && chartData.length > 30) {
            chartData = chartData.slice(-30);
        }

        renderIncendioChart(chartData, serial, periodo, forceRedraw);
    } catch (err) {
        console.warn('[Incêndio Chart] Erro:', err.message);
    }
}

function renderIncendioChart(data, serial = '', periodo = '', forceRedraw = false) {
    const engine = getFluidTelemetryEngine();
    if (!engine) return;

    engine.loadHistory(data, serial);
}

/* ==========================================================================
   MODAL DE REGISTROS DE LEITURAS & EXPORTAÇÃO CSV / EXCLUSÃO
   (Utilitários compartilhados em ../../shared/ui/registros-modal.js)
   ========================================================================== */

function openRegistrosModal() {
    const modal = document.getElementById('registrosModal');
    if (!modal) return;

    const filterDevSelect = document.getElementById('filterModalDispositivo');
    if (filterDevSelect) {
        filterDevSelect.innerHTML = '<option value="todos">Todas as Centrais</option>';
        if (Array.isArray(currentIncendios) && currentIncendios.length > 0) {
            currentIncendios.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.numero_serie;
                opt.textContent = `${d.numero_serie} - ${d.nome || 'Rede'}`;
                filterDevSelect.appendChild(opt);
            });
        }

        if (selectedDeviceSerial && currentIncendios.some(d => d.numero_serie === selectedDeviceSerial)) {
            filterDevSelect.value = selectedDeviceSerial;
        } else {
            filterDevSelect.value = 'todos';
        }
    }

    limparFeedbackModal();
    modal.classList.add('active');
    document.addEventListener('keydown', handleRegistrosEscKey);

    carregarRegistrosModal(1);
}

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
        tableBody.innerHTML = '<tr><td colspan="10" class="table-state-message">Consultando telemetria no banco de dados...</td></tr>';
    }

    const filterDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
    const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
    const dataFim = document.getElementById('filterModalDataFim')?.value || '';

    const params = new URLSearchParams({
        page: registrosCurrentPage,
        limit: registrosPageLimit,
        numeroSerie: filterDev,
        dataInicio: dataInicio,
        dataFim: dataFim
    });

    try {
        let recordsResult = null;
        try {
            const res = await fetch(`${API_BASE}/api/incendio/registros?${params.toString()}`, {
                headers: getAuthHeaders()
            });
            if (res.ok) {
                recordsResult = await res.json();
            }
        } catch (apiErr) {
            console.warn('[Incêndio Registros] Erro na API:', apiErr.message);
        }

        if (!recordsResult || !recordsResult.success) {
            recordsResult = { success: true, data: [], total: 0, totalPages: 1 };
        }

        const pag = recordsResult.pagination || recordsResult;
        registrosTotalPages = pag.totalPages || 1;
        const rows = recordsResult.data || [];
        const total = pag.total || 0;

        if (totalCountEl) totalCountEl.innerText = `${total} registro(s) encontrado(s)`;
        if (pageIndicator) pageIndicator.innerText = `Página ${registrosCurrentPage} de ${Math.max(1, registrosTotalPages)}`;
        if (btnPrev) btnPrev.disabled = registrosCurrentPage <= 1;
        if (btnNext) btnNext.disabled = registrosCurrentPage >= registrosTotalPages;

        if (!tableBody) return;

        if (rows.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="10" class="table-state-message">Nenhum registro encontrado para o filtro informado.</td></tr>';
            return;
        }

        tableBody.innerHTML = rows.map(r => {
            const dev = currentIncendios.find(d => d.numero_serie === r.numero_serie);
            const cliente = r.cliente || dev?.cliente || 'Empresa Matriz';
            const setor = dev?.nome || 'Setor de Bombas';
            const dataHora = r.timestamp ? new Date(r.timestamp).toLocaleString('pt-BR') : '--';
            const pressao = r.sensor1 !== null && r.sensor1 !== undefined ? `${Number(r.sensor1).toFixed(2)} psi` : '--';
            
            const r1On = r.rele1_on !== null && r.rele1_on !== undefined ? `${Number(r.rele1_on).toFixed(1)} psi` : '--';
            const r1Off = r.rele1_off !== null && r.rele1_off !== undefined ? `${Number(r.rele1_off).toFixed(1)} psi` : '--';
            const r1Ac = r.rele1_acionamentos !== null && r.rele1_acionamentos !== undefined ? r.rele1_acionamentos : '--';

            const r2On = r.rele2_on !== null && r.rele2_on !== undefined ? `${Number(r.rele2_on).toFixed(1)} psi` : '--';
            const r2Off = r.rele2_off !== null && r.rele2_off !== undefined ? `${Number(r.rele2_off).toFixed(1)} psi` : '--';
            const r2Ac = r.rele2_acionamentos !== null && r.rele2_acionamentos !== undefined ? r.rele2_acionamentos : '--';

            return `
                <tr>
                    <td><strong>${escapeHtml(r.numero_serie)}</strong></td>
                    <td>${escapeHtml(cliente)} (${escapeHtml(setor)})</td>
                    <td>${dataHora}</td>
                    <td style="color: var(--primary-blue); font-weight: 700;">${pressao}</td>
                    <td>${r1On}</td>
                    <td>${r1Off}</td>
                    <td>${r1Ac}</td>
                    <td>${r2On}</td>
                    <td>${r2Off}</td>
                    <td>${r2Ac}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="10" class="table-state-message" style="color: #ef4444;">Erro ao carregar registros: ${escapeHtml(err.message)}</td></tr>`;
        }
    } finally {
        isFetchingRegistros = false;
    }
}

function mudarPaginaRegistros(delta) {
    const targetPage = registrosCurrentPage + delta;
    if (targetPage >= 1 && targetPage <= registrosTotalPages) {
        carregarRegistrosModal(targetPage);
    }
}

function filtrarRegistrosModal() {
    carregarRegistrosModal(1);
}

/**
 * Exporta registros filtrados em planilha CSV
 */
async function exportarRegistrosCSV() {
    const btn = document.getElementById('btnExportarCSV');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Exportando...';
    }

    try {
        const filterDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
        const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
        const dataFim = document.getElementById('filterModalDataFim')?.value || '';

        let exportData = [];
        try {
            const params = new URLSearchParams({
                limit: 2000,
                numeroSerie: filterDev,
                dataInicio: dataInicio,
                dataFim: dataFim
            });
            const res = await fetch(`${API_BASE}/api/incendio/registros?${params.toString()}`, {
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const resJson = await res.json();
                if (resJson.success && Array.isArray(resJson.data)) {
                    exportData = resJson.data;
                }
            }
        } catch (e) {
            console.warn('[Incêndio Export] Erro:', e.message);
        }

        if (exportData.length === 0) {
            mostrarFeedbackModal('Nenhum dado encontrado para exportação no período informado.', 'error');
            return;
        }

        const headers = ['Central / Série', 'Cliente / Setor', 'Data e Hora', 'Pressão da Rede (psi)', 'Bomba Principal ON', 'Bomba Principal OFF', 'Partidas Principal', 'Bomba Jockey ON', 'Bomba Jockey OFF', 'Partidas Jockey'];
        const csvRows = [headers.join(';')];

        exportData.forEach(r => {
            const dev = currentIncendios.find(d => d.numero_serie === r.numero_serie);
            const cliente = `"${(r.cliente || dev?.cliente || dev?.nome || 'Sistema de Incêndio').replace(/"/g, '""')}"`;
            const dataHora = r.timestamp ? new Date(r.timestamp).toLocaleString('pt-BR') : '--';
            const pressao = r.sensor1 !== null && r.sensor1 !== undefined ? Number(r.sensor1).toFixed(2) : '--';

            csvRows.push([
                r.numero_serie,
                cliente,
                `"${dataHora}"`,
                pressao,
                r.rele1_on ?? '--',
                r.rele1_off ?? '--',
                r.rele1_acionamentos ?? 0,
                r.rele2_on ?? '--',
                r.rele2_off ?? '--',
                r.rele2_acionamentos ?? 0
            ].join(';'));
        });

        const csvContent = '\uFEFF' + csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const nowStr = new Date().toISOString().slice(0, 10);
        link.download = `relatorio_sistema_incendio_${nowStr}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        mostrarFeedbackModal(`Exportação concluída com sucesso! (${exportData.length} registros exportados)`, 'success');
    } catch (err) {
        mostrarFeedbackModal(`Erro ao exportar CSV: ${err.message}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

function abrirConfirmacaoExclusao() {
    const modal = document.getElementById('confirmDeleteModal');
    if (!modal) return;

    const filterDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
    const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
    const dataFim = document.getElementById('filterModalDataFim')?.value || '';

    if (!dataInicio && !dataFim) {
        mostrarFeedbackModal('Por segurança, defina um intervalo de datas para executar a exclusão de registros.', 'error');
        return;
    }

    const devLabel = document.getElementById('confirmDeleteDispositivo');
    const startLabel = document.getElementById('confirmDeleteDataInicio');
    const endLabel = document.getElementById('confirmDeleteDataFim');

    if (devLabel) devLabel.innerText = filterDev === 'todos' ? 'Todas as Centrais' : filterDev;
    if (startLabel) startLabel.innerText = dataInicio ? new Date(dataInicio).toLocaleString('pt-BR') : 'Início dos registros';
    if (endLabel) endLabel.innerText = dataFim ? new Date(dataFim).toLocaleString('pt-BR') : 'Até o momento atual';

    modal.classList.add('active');
}

async function executarExclusaoRegistros() {
    const btn = document.getElementById('btnConfirmDeleteAction');
    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Apagando...';
    }

    try {
        const filterDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
        const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
        const dataFim = document.getElementById('filterModalDataFim')?.value || '';

        const res = await fetch(`${API_BASE}/api/incendio/registros`, {
            method: 'DELETE',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ numeroSerie: filterDev, dataInicio, dataFim })
        });
        const result = await res.json().catch(() => ({}));

        fecharConfirmacaoExclusao();
        if (!res.ok || result.success === false) {
            mostrarFeedbackModal(result.message || 'Não foi possível apagar os registros.', 'error');
            return;
        }
        mostrarFeedbackModal(result.message || 'Registros no período selecionado foram apagados com sucesso.', 'success');
        carregarRegistrosModal(1);
    } catch (err) {
        mostrarFeedbackModal(`Erro ao apagar registros: ${err.message}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = 'Sim, Apagar Registros';
        }
    }
}

// ====================================================
// FULLSCREEN PRESENTATION MODE (CARROSSEL COM CARDS E GRÁFICO)
// ====================================================

function getPressureColor(val, minPrincipalOn, minJockeyOn) {
    if (val === null || val === undefined) return '#0f172a';
    const v = Number(val);
    const pOn = minPrincipalOn ? Number(minPrincipalOn) : 85.0;
    const jOn = minJockeyOn ? Number(minJockeyOn) : 95.0;

    if (v < pOn) return '#ef4444'; // Crítico / Combate Principal
    if (v <= jOn) return '#ea580c'; // Atenção / Jockey
    if (v >= 105 && v <= 135) return '#10b981'; // Ideal / Pressurizado
    if (v > 140) return '#ea580c'; // Sobrepressão
    return '#0284c7';
}

/**
 * Renderiza a central ativa no Modo Tela Cheia com os 4 Cards e o Gráfico dedicado
 */
function renderFullscreenStation(index) {
    if (!currentIncendios || currentIncendios.length === 0) return;

    index = fsCarousel.setActiveIndex(index);

    const dev = currentIncendios[index];
    const u = dev.ultima_leitura || {};

    // 1. Header Metadata
    const titleEl = document.getElementById('fsDeviceTitle');
    if (titleEl) titleEl.innerText = `${dev.numero_serie} - ${dev.nome || 'Rede de Combate a Incêndio'}`;

    const pressure = (u.sensor1 !== null && u.sensor1 !== undefined) ? Number(u.sensor1) : null;
    const r1_on = u.rele1_on !== null && u.rele1_on !== undefined ? Number(u.rele1_on) : 85.0;
    const r1_off = u.rele1_off !== null && u.rele1_off !== undefined ? Number(u.rele1_off) : 125.0;
    const r2_on = u.rele2_on !== null && u.rele2_on !== undefined ? Number(u.rele2_on) : 95.0;
    const r2_off = u.rele2_off !== null && u.rele2_off !== undefined ? Number(u.rele2_off) : 125.0;

    const isR1On = pressure !== null && (u.rele1_estado === 1 || pressure <= r1_on);
    const isR2On = pressure !== null && (u.rele2_estado === 1 || pressure <= r2_on);

    const isCrit = dev.status === 'Crítico' || (pressure !== null && pressure < r1_on) || isR1On;
    const isWarn = dev.status === 'Atenção' || (pressure !== null && pressure <= r2_on) || isR2On;
    const stClass = isCrit ? 'critico' : (isWarn ? 'atencao' : 'operacional');
    const stLabel = isCrit ? 'Crítico (Disparo Combate)' : (isWarn ? 'Atenção (Disparo Jockey)' : 'Pressurizado / Normal');

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
    const pColor = getPressureColor(pressure, r1_on, r2_on);
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
        } else if (isR1On || pressure < r1_on) {
            pEvalEl.innerText = 'Disparo Combate';
            pEvalEl.style.background = '#fef2f2';
            pEvalEl.style.color = '#dc2626';
        } else if (isR2On || pressure <= r2_on) {
            pEvalEl.innerText = 'Disparo Jockey';
            pEvalEl.style.background = '#fff7ed';
            pEvalEl.style.color = '#ea580c';
        } else {
            pEvalEl.innerText = 'Normal / Ideal';
            pEvalEl.style.background = '#ecfdf5';
            pEvalEl.style.color = '#059669';
        }
    }

    updateFsGaugeChart(pressure, 0, 180, pColor);

    // 3. Card 2: Bomba Principal de Combate
    const r1Badge = document.getElementById('fsR1StateBadge');
    const r1Text = document.getElementById('fsR1StatusText');
    const r1OnVal = document.getElementById('fsR1OnVal');
    const r1OffVal = document.getElementById('fsR1OffVal');
    const r1AcVal = document.getElementById('fsR1AcVal');

    if (r1Badge) {
        r1Badge.className = `fs-relay-pill ${isR1On ? 'on' : 'off'}`;
        r1Badge.innerText = isR1On ? 'DISPARADA' : 'STANDBY';
    }
    if (r1Text) {
        r1Text.innerText = isR1On ? 'COMBATE ATIVO' : 'STANDBY';
        r1Text.style.color = isR1On ? '#dc2626' : '#64748b';
    }
    if (r1OnVal) r1OnVal.innerText = `${r1_on.toFixed(1)} psi`;
    if (r1OffVal) r1OffVal.innerText = `${r1_off.toFixed(1)} psi`;
    if (r1AcVal) r1AcVal.innerText = u.rele1_acionamentos || 0;

    // 4. Card 3: Bomba Jockey (Pressurização)
    const r2Badge = document.getElementById('fsR2StateBadge');
    const r2Text = document.getElementById('fsR2StatusText');
    const r2OnVal = document.getElementById('fsR2OnVal');
    const r2OffVal = document.getElementById('fsR2OffVal');
    const r2AcVal = document.getElementById('fsR2AcVal');

    if (r2Badge) {
        r2Badge.className = `fs-relay-pill ${isR2On ? 'jockey-on' : 'off'}`;
        r2Badge.innerText = isR2On ? 'LIGADA' : 'STANDBY';
    }
    if (r2Text) {
        r2Text.innerText = isR2On ? 'REPRESSURIZANDO' : 'STANDBY';
        r2Text.style.color = isR2On ? '#ea580c' : '#64748b';
    }
    if (r2OnVal) r2OnVal.innerText = `${r2_on.toFixed(1)} psi`;
    if (r2OffVal) r2OffVal.innerText = `${r2_off.toFixed(1)} psi`;
    if (r2AcVal) r2AcVal.innerText = u.rele2_acionamentos || 0;

    // 5. Card 4: Diagnóstico & Supervisão NFPA / AVCB
    const diagChip = document.getElementById('fsDiagChip');
    const diagStatus = document.getElementById('fsDiagStatusText');
    const diagStability = document.getElementById('fsDiagStability');
    const diagReadiness = document.getElementById('fsDiagReadiness');

    if (diagChip && diagStatus) {
        if (isR1On) {
            diagChip.className = 'fs-diag-chip fire';
            diagChip.innerText = 'ALARME COMBATE';
            diagStatus.innerText = 'DISPARO GERAL';
            if (diagStability) {
                diagStability.innerText = 'Queda Crítica';
                diagStability.style.color = '#dc2626';
            }
            if (diagReadiness) diagReadiness.innerText = 'Em Atuação de Emergência';
        } else if (isR2On) {
            diagChip.className = 'fs-diag-chip alert';
            diagChip.innerText = 'RECOMPONDO';
            diagStatus.innerText = 'JOCKEY EM OPERAÇÃO';
            if (diagStability) {
                diagStability.innerText = 'Oscilação Compensada';
                diagStability.style.color = '#ea580c';
            }
            if (diagReadiness) diagReadiness.innerText = 'Recompondo Pressão';
        } else {
            diagChip.className = 'fs-diag-chip normal';
            diagChip.innerText = 'PRONTO';
            diagStatus.innerText = 'REDE PRESSURIZADA';
            if (diagStability) {
                diagStability.innerText = 'Estável';
                diagStability.style.color = '#10b981';
            }
            if (diagReadiness) diagReadiness.innerText = '100% Operacional (AVCB)';
        }
    }

    // 6. Gráfico em tempo real Fullscreen da central ativa
    renderFullscreenChart(dev);

    // 7. Sincroniza select, dots e contador
    fsCarousel.renderFsDots();
    const select = document.getElementById('fsDeviceSelect');
    if (select && select.value !== dev.numero_serie) {
        select.value = dev.numero_serie;
    }
    const counterEl = document.getElementById('fsDeviceCounterText');
    if (counterEl) {
        counterEl.innerText = `Central ${fsCarousel.getActiveIndex() + 1} de ${currentIncendios.length}`;
    }
}

async function renderFullscreenChart(dev) {
    const canvas = document.getElementById('fsIncendioChart');
    if (!canvas || typeof Chart === 'undefined') return;

    // Histórico real da estação (antes: pontos gerados com Math.random). Recarrega
    // ao trocar de estação ou a cada 30 s; entre uma carga e outra mantém o gráfico.
    if (fsChartSerial === dev.numero_serie && fsChartInstanceReady() && Date.now() - fsChartLoadedAt < 30000) return;
    fsChartSerial = dev.numero_serie;
    fsChartLoadedAt = Date.now();
    const historico = dev.isSimulated ? [] : await window.SensoriumHistory.load(`/api/incendio/${encodeURIComponent(dev.numero_serie)}/leituras`, 30);
    if (fsChartSerial !== dev.numero_serie) return;

    const u = dev.ultima_leitura || {};
    const r1_on = Number(u.rele1_on || 85.0);
    const r1_off = Number(u.rele1_off || 125.0);
    const r2_on = Number(u.rele2_on || 95.0);

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

    if (fsIncendioChartInstance) {
        try {
            fsIncendioChartInstance.destroy();
        } catch (e) {}
        fsIncendioChartInstance = null;
    }

    try {
        const ctx = canvas.getContext('2d');
        fsIncendioChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Pressão da Rede (psi)',
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
                        label: 'Disparo Bomba Principal (ON)',
                        data: r1OnData,
                        borderColor: '#dc2626',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        fill: false,
                        pointRadius: 0
                    },
                    {
                        label: 'Disparo Bomba Jockey (ON)',
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
                        min: 50,
                        max: 160,
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
