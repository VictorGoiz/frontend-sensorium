let mapInstance = null;
let currentDevices = [];
// Limites e Ranges Prescritos dinâmicos (atualizados do banco)
let currentLimites = {
    temperatura: { min_ideal: 18.0, max_ideal: 26.0, crit_min: 15.0, crit_max: 30.0, unit: '°C', label: 'Temperatura' },
    umidade: { min_ideal: 30.0, max_ideal: 60.0, crit_min: 20.0, crit_max: 75.0, unit: '%', label: 'Umidade' },
    co2: { max_ideal: 800.0, max_aviso: 1000.0, unit: 'ppm', label: 'Dióxido de Carbono (CO2)' },
    pm25: { max_ideal: 15.0, max_aviso: 25.0, unit: 'µg/m³', label: 'Partículas Finas (PM2.5)' },
    pm10: { max_ideal: 30.0, max_aviso: 50.0, unit: 'µg/m³', label: 'Partículas Grossas (PM10)' },
    voc: { max_ideal: 0.20, max_aviso: 0.30, unit: 'ppm', label: 'Compostos Orgânicos Voláteis (VOC)' },
    formaldeido: { max_ideal: 0.05, max_aviso: 0.10, unit: 'mg/m³', label: 'Formaldeído (HCHO)' }
};
// Assinatura da última leitura processada: evita atualizar a mesma leitura duas
// vezes quando 'sensor_reading' e 'dashboard_update' chegam juntos (push duplo).
// Controle de precisão do tempo real, POR DISPOSITIVO:
// - lastReadingKeyBySerial: leitura já exibida (leitura_id do banco; assinatura
//   completa das 7 variáveis como fallback) -> não reaplica a mesma leitura quando
//   'sensor_reading' e 'dashboard_update' chegam juntos.
// - Uma leitura só substitui a exibida se for MAIS NOVA (leitura_id maior). Isso
//   impede que uma resposta de polling atrasada "volte" a tela para um valor antigo.
const lastReadingKeyBySerial = new Map();
let devicesFetchInFlight = false;
let alertsRefreshTimer = null;
let sensorBadgeWatchdog = null;
let simulationStepCount = 0;

// ============================================================================
// CONFIGURAÇÃO DE DADOS SIMULADOS (shared/mocks/lfg60.mock.js)
// E HELPERS DE TRADUÇÃO (config.js / shared/core/formatters.js)
// ============================================================================
const USE_SIMULATED_LFG60 = typeof window.USE_SIMULATED_LFG60 !== 'undefined' ? window.USE_SIMULATED_LFG60 : !!window.SENSORIUM_DEMO;
const SIMULATED_LFG60_DEVICES = window.SIMULATED_LFG60_DEVICES || [];

// Tela cheia / carrossel: mecânica em shared/ui/fullscreen-presenter.js
const fsCarousel = window.SensoriumFullscreen.bindFullscreenCarousel({
    getDevices: () => currentDevices,
    render: (index) => renderFullscreenDevice(index),
    standardSelectId: 'lfgDeviceSelect',
    formatOptionLabel: (d, i, n) => `Transmissor ${d.numero_serie} (${i + 1}/${n})`,
    emptyOptionLabel: 'Nenhum transmissor',
    dotTitlePrefix: 'Ir para o transmissor',
    dotsContainerId: 'fsCarouselDots',
    labels: { enter: 'Tela Cheia', exit: 'Sair da Tela Cheia' },
    swapIcon: true,
    autoStart: false,
    playingClass: 'active',
    restartAutoplayOnNavigate: true,
    onEmpty: () => renderFullscreenEmptyState(),
    onFullscreenToggle: (isFs) => {
        if (!isFs) setTimeout(updateCarouselState, 250);
    }
});

// Central de alertas: shared/ui/alerts-popover.js (endpoints do LFG60)
window.SensoriumAlerts.configure({ basePath: '/api/lfg60/alertas' });

function translateLed(led) {
    return window.translateLedEn ? window.translateLedEn(led) : (led || 'Verde');
}

function translateStatus(st) {
    return window.translateStatusEn ? window.translateStatusEn(st) : (st || 'Operacional');
}

function translateParamKey(param) {
    return window.translateParamKeyEn ? window.translateParamKeyEn(param) : param;
}

/**
 * Updates live transmission badge state for LFG60
 */
function setSensorLiveBadgeState(isLive) {
    const badge = document.getElementById('livePresentationBadge') || document.getElementById('sensorLiveBadge');
    const badgeText = document.getElementById('liveBadgeText');
    if (!badge) return;

    if (isLive) {
        badge.classList.add('active');
        if (badgeText) badgeText.innerText = 'AO VIVO';
        if (sensorBadgeWatchdog) clearTimeout(sensorBadgeWatchdog);
        sensorBadgeWatchdog = setTimeout(() => {
            setSensorLiveBadgeState(false);
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

    // 1. Load Sensors and Alerts from API / Mock
    loadDashboardData();

    // Variação dos dispositivos simulados a cada 300ms (conforme script time.sleep(0.3))
    setInterval(simulateLiveLfg60Step, 300);

    // Connect via Socket.IO for real-time updates with debounce
    let updateDebounceTimer = null;
    function triggerDashboardUpdate(data) {
        setSensorLiveBadgeState(true);
        if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
        updateDebounceTimer = setTimeout(() => {
            loadDashboardData();
            
            const modal = document.getElementById('sensorModal');
            if (modal && modal.classList.contains('active') && data?.numeroSerie) {
                const title = document.getElementById('modalSensorTitle')?.innerText || '';
                if (title.includes(data.numeroSerie)) {
                    fetchDeviceHistory(data.numeroSerie);
                }
            }
        }, 80);
    }

    if (typeof io !== 'undefined') {
        const socket = io(API_BASE, {
            auth: { token: localStorage.getItem('sensorium_token') },
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            transports: ['websocket', 'polling']
        });

        // Push com a leitura completa (padrão de relés/incêndio): atualiza as
        // variáveis no lugar, sem refazer o fetch de todos os dispositivos.
        socket.on('sensor_reading', (data) => {
            handleLiveSensorReading(data);
        });

        socket.on('dashboard_update', (data) => {
            // Eventos de chopeiras / incêndio / pressurização também chegam nesta sala
            // da empresa; eles NÃO são desta tela e não devem disparar recargas.
            if (!data || data.type !== 'sensor_data') return;
            if (data.data) {
                handleLiveSensorReading(data.data);   // formato atual: já traz a leitura
            } else {
                triggerDashboardUpdate(data);         // backend antigo: só o aviso
            }
        });

        socket.on('disconnect', () => {
            setSensorLiveBadgeState(false);
        });

        // Polling CONTÍNUO dos dispositivos (mesmo padrão do chopeiras): garante
        // que a tela fique sempre correta mesmo que algum push do socket não
        // chegue (ex.: PM2 em cluster, reconexão, perda de pacote). O push via
        // socket continua dando a atualização INSTANTÂNEA quando disponível; o
        // dedupe por assinatura evita processar a mesma leitura duas vezes.
        setInterval(fetchDevicesFromApi, 1000);
        // Alertas + ressincronização completa num ritmo mais espaçado.
        setInterval(loadDashboardData, 15000);
    } else {
        console.warn('[LFG60] Socket.IO not loaded. Falling back to polling.');
        setInterval(loadDashboardData, 2000);
    }


    // Carousel scroll and resize listeners
    const container = document.getElementById('sensorListContainer');
    if (container) {
        container.addEventListener('scroll', handleCarouselScroll);
    }
    window.addEventListener('resize', updateCarouselState);

    // Close alerts popover on outside click
    document.addEventListener('click', function(e) {
        const popover = document.getElementById('headerAlertsPopover');
        const alertBtn = document.getElementById('headerAlertBtn');
        if (popover && popover.classList.contains('active')) {
            if (!popover.contains(e.target) && !alertBtn.contains(e.target)) {
                popover.classList.remove('active');
            }
        }
    });
});

async function fetchLimitesFromApi() {
    try {
        const res = await fetch(`${API_BASE}/api/lfg60/limites`, {
            headers: getAuthHeaders()
        });
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') {
                currentLimites = { ...currentLimites, ...data };
            }
        }
    } catch (e) {
        console.warn('[LFG60] Erro ao buscar limites prescritos da API:', e.message);
    }
}

async function loadDashboardData() {
    await Promise.all([
        fetchLimitesFromApi(),
        fetchDevicesFromApi(),
        fetchAlertsFromApi()
    ]);
}

// ----------------------------------------------------
// 1. DEVICES AND READINGS FROM API / SIMULATION
// ----------------------------------------------------
async function fetchDevicesFromApi() {
    // Evita requisições sobrepostas (uma resposta antiga chegando depois de uma nova).
    if (devicesFetchInFlight) return;
    devicesFetchInFlight = true;
    try {
        await fetchDevicesFromApiImpl();
    } finally {
        devicesFetchInFlight = false;
    }
}

async function fetchDevicesFromApiImpl() {
    try {
        let loadedData = null;
        try {
            const res = await fetch(`${API_BASE}/api/lfg60`, {
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const result = await res.json();
                if (result.prescribed_ranges && typeof result.prescribed_ranges === 'object') {
                    currentLimites = { ...currentLimites, ...result.prescribed_ranges };
                }
                if (result.success && Array.isArray(result.data)) {
                    loadedData = result.data;
                }
            }
        } catch (apiErr) {
            console.warn('[LFG60] API fetch warning:', apiErr.message);
        }

        if (loadedData !== null && loadedData.length > 0) {
            currentDevices = mergeDevicesPreservingNewest(loadedData);
        } else if (USE_SIMULATED_LFG60) {
            currentDevices = JSON.parse(JSON.stringify(SIMULATED_LFG60_DEVICES));
        } else {
            currentDevices = loadedData || [];
        }

        updateLfgDeviceSelect(currentDevices);
        renderSensorCards(currentDevices);
        updateDashboardSummary(currentDevices);

        if (document.body.classList.contains('fullscreen-active')) {
            updateFullscreenTelemetry();
        }

        const hasData = currentDevices.length > 0 && currentDevices.some(d => d.ultima_leitura && (d.ultima_leitura.temperatura !== null || d.ultima_leitura.umidade !== null || d.ultima_leitura.co2 !== null));
        setSensorLiveBadgeState(hasData);
    } catch (err) {
        console.warn('[LFG60] Error loading sensors:', err.message);
        if (USE_SIMULATED_LFG60 && currentDevices.length === 0) {
            currentDevices = JSON.parse(JSON.stringify(SIMULATED_LFG60_DEVICES));
        } else if (!USE_SIMULATED_LFG60) {
            currentDevices = [];
        }
        updateLfgDeviceSelect(currentDevices);
        renderSensorCards(currentDevices);
        updateDashboardSummary(currentDevices);
        if (document.body.classList.contains('fullscreen-active')) {
            updateFullscreenTelemetry();
        }
        setSensorLiveBadgeState(false);
    }
}

/**
 * Identifica uma leitura: leitura_id do banco (preciso e monotônico) ou, se o
 * backend ainda não enviar o id, uma assinatura com TODAS as variáveis.
 */
function readingKey(numeroSerie, r) {
    if (!r) return '';
    if (r.leitura_id !== undefined && r.leitura_id !== null) return `id:${r.leitura_id}`;
    return `sig:${numeroSerie}|${r.timestamp}|${r.temperatura}|${r.umidade}|${r.co2}|${r.pm25}|${r.pm10}|${r.voc}|${r.formaldeido}|${r.led}`;
}

/** true se `incoming` é ESTRITAMENTE mais nova que `current`. */
function isStrictlyNewerReading(incoming, current) {
    if (!incoming) return false;
    if (!current) return true;
    const a = incoming.leitura_id, b = current.leitura_id;
    if (a !== undefined && a !== null && b !== undefined && b !== null) return Number(a) > Number(b);
    const ta = String(incoming.timestamp || ''), tb = String(current.timestamp || '');
    return ta > tb;
}

/**
 * Junta a resposta do REST com o que já está na tela SEM regredir: se o dispositivo
 * já exibe uma leitura igual ou mais nova (ex.: recebida via push enquanto esta
 * requisição estava em trânsito), ela é mantida.
 */
function mergeDevicesPreservingNewest(rows) {
    return rows.map(row => {
        const existing = currentDevices.find(d => d.numero_serie === row.numero_serie);
        if (existing && existing.ultima_leitura && !isStrictlyNewerReading(row.ultima_leitura, existing.ultima_leitura)) {
            return { ...row, ultima_leitura: existing.ultima_leitura, led: existing.led, status: existing.status };
        }
        if (row.ultima_leitura) {
            lastReadingKeyBySerial.set(row.numero_serie, readingKey(row.numero_serie, row.ultima_leitura));
        }
        return row;
    });
}

/** Atualiza alertas no máximo a cada 1,5 s quando o LED/status de algum dispositivo muda. */
function scheduleAlertsRefresh() {
    if (alertsRefreshTimer) return;
    alertsRefreshTimer = setTimeout(() => {
        alertsRefreshTimer = null;
        fetchAlertsFromApi();
    }, 1500);
}

/**
 * Recebe uma leitura completa via Socket.IO (push) e atualiza TODAS as variáveis
 * do dispositivo no lugar — card, resumo, modal e tela cheia — sem refazer o fetch
 * da lista. Ignora duplicatas (mesma leitura) e leituras fora de ordem (mais antigas).
 */
function handleLiveSensorReading(reading) {
    if (!reading || !reading.numeroSerie) return;

    const { numeroSerie, temperatura, umidade, co2, pm25, pm10, voc, formaldeido, led, status, timestamp, leitura_id } = reading;

    const key = readingKey(numeroSerie, reading);
    if (lastReadingKeyBySerial.get(numeroSerie) === key) return;

    setSensorLiveBadgeState(true);

    const dev = currentDevices.find(d => d.numero_serie === numeroSerie);
    if (!dev) {
        // Dispositivo ainda não está na lista (recém-vinculado): busca a lista.
        fetchDevicesFromApi();
        return;
    }

    // Leitura fora de ordem (mais antiga que a já exibida): não regride a tela.
    const cur = dev.ultima_leitura;
    if (cur && leitura_id !== undefined && leitura_id !== null && cur.leitura_id !== undefined && cur.leitura_id !== null
        && Number(leitura_id) < Number(cur.leitura_id)) {
        return;
    }

    lastReadingKeyBySerial.set(numeroSerie, key);
    const prevLed = dev.led;
    const prevStatus = dev.status;

    dev.ultima_leitura = {
        temperatura: temperatura ?? null,
        umidade: umidade ?? null,
        co2: co2 ?? null,
        pm25: pm25 ?? null,
        pm10: pm10 ?? null,
        voc: voc ?? null,
        formaldeido: formaldeido ?? null,
        timestamp: timestamp || new Date().toISOString(),
        leitura_id: leitura_id ?? null
    };
    if (led !== undefined && led !== null) dev.led = led;
    if (status !== undefined && status !== null) dev.status = status;

    // Card (temperatura, umidade, CO2, gauges e badge) + resumo do topo.
    updateSingleSensorCardInPlace(dev);
    updateDashboardSummary(currentDevices);

    // Modal de detalhes aberto neste dispositivo: atualiza as 7 variáveis.
    const modal = document.getElementById('sensorModal');
    if (modal && modal.classList.contains('active')) {
        const title = document.getElementById('modalSensorTitle')?.innerText || '';
        if (title.includes(numeroSerie)) {
            updateOpenModalSimulatedValues(dev);
        }
    }

    // Tela cheia exibindo este dispositivo: atualiza a telemetria.
    if (document.body.classList.contains('fullscreen-active')) {
        const activeDev = currentDevices[fsCarousel.getActiveIndex()];
        if (activeDev && activeDev.numero_serie === numeroSerie) {
            renderFullscreenDevice(fsCarousel.getActiveIndex());
        }
    }

    // LED/status mudou -> novos alertas podem ter sido gerados.
    if (prevLed !== dev.led || prevStatus !== dev.status) {
        scheduleAlertsRefresh();
    }
}

/**
 * Atualização direta in-place do card do dispositivo simulado (fluidez total a 60 FPS)
 */
function updateSingleSensorCardInPlace(dev) {
    if (!dev || !dev.numero_serie) return;
    const l = dev.ultima_leitura || {};
    const led = dev.led || 'Green';
    const statusRaw = dev.status || 'Operational';
    const isAlert = led === 'Amarelo' || led === 'Vermelho' || led === 'Yellow' || led === 'Red' || (statusRaw !== 'Operacional' && statusRaw !== 'Operational');

    const tempVal = l.temperatura !== null && l.temperatura !== undefined ? Number(l.temperatura) : null;
    const umidVal = l.umidade !== null && l.umidade !== undefined ? Number(l.umidade) : null;
    const co2Text = l.co2 !== null && l.co2 !== undefined ? `${l.co2} ppm` : '--';

    const tempDisplay = tempVal !== null ? `${tempVal.toFixed(1)}°C` : '--';
    const umidDisplay = umidVal !== null ? `${umidVal.toFixed(1)}%` : '--';

    const tempColor = getTemperatureGaugeColor(tempVal);
    const umidColor = getHumidityGaugeColor(umidVal);

    const cardEl = document.getElementById(`sensor-card-${dev.numero_serie}`);
    if (cardEl) {
        cardEl.className = `sensor-card ${isAlert ? 'alert' : ''}`;
    }

    const badgeEl = document.getElementById(`status-badge-${dev.numero_serie}`);
    if (badgeEl) {
        const isCrit = statusRaw === 'Crítico' || statusRaw === 'Critical';
        const isWarn = statusRaw === 'Atenção' || statusRaw === 'Warning';
        const statusClass = isCrit ? 'critico' : (isWarn ? 'atencao' : 'operacional');
        const dotClass = (led === 'Vermelho' || led === 'Red') ? 'red' : ((led === 'Amarelo' || led === 'Yellow') ? 'yellow' : 'green');
        const translatedSt = translateStatus(statusRaw);
        badgeEl.className = `header-status-badge ${statusClass}`;
        badgeEl.innerHTML = `<span class="status-dot ${dotClass}" title="LED: ${translateLed(led)}"></span><span>${translatedSt}</span>`;
    }

    const tempTextEl = document.getElementById(`temp-val-${dev.numero_serie}`);
    if (tempTextEl) {
        tempTextEl.innerText = tempDisplay;
        tempTextEl.style.color = tempColor;
    }

    const umidTextEl = document.getElementById(`umid-val-${dev.numero_serie}`);
    if (umidTextEl) {
        umidTextEl.innerText = umidDisplay;
        umidTextEl.style.color = umidColor;
    }

    const co2El = document.getElementById(`co2-val-${dev.numero_serie}`);
    if (co2El) co2El.innerText = co2Text;

    initOrUpdateManometroGauge(`gauge-temp-${dev.numero_serie}`, tempVal, 0, 50, tempColor);
    initOrUpdateManometroGauge(`gauge-umid-${dev.numero_serie}`, umidVal, 0, 100, umidColor);
}

/**
 * Simulação dos valores de telemetria baseada na lógica:
 * Temperatura variando de 23.0°C até 35.0°C com incremento de 0.5 a cada 300ms,
 * invertendo nos limites e mantendo valores estáticos dos demais parâmetros.
 */
function simulateLiveLfg60Step() {
    if (!USE_SIMULATED_LFG60 || !currentDevices || currentDevices.length === 0) return;

    let hasSimulated = false;

    currentDevices.forEach((dev, idx) => {
        // Apenas alterar dispositivos explicitamente simulados, nunca sobrescrever dispositivos reais de produção
        if (dev && (dev.isSimulated === true || (dev.numero_serie && dev.numero_serie.startsWith('LFG60-SIM')))) {
            hasSimulated = true;
            if (!dev.ultima_leitura) {
                dev.ultima_leitura = {};
            }

            // Inicializa estado (SIM-01 em 23.0°C, SIM-02 em 28.0°C para variação balanceada)
            if (typeof dev._simTemp === 'undefined') {
                dev._simTemp = idx === 0 ? 23.0 : 28.0;
                dev._simInc = 0.5;
            }

            const l = dev.ultima_leitura;
            l.temperatura = Number(dev._simTemp.toFixed(1));
            l.umidade = 55.0;
            l.co2 = 450;
            l.pm25 = 10.2;
            l.pm10 = 18.0;
            l.voc = 0.15;
            l.formaldeido = 0.02;
            l.timestamp = new Date().toISOString();

            // Atualiza temperatura e inverte direção nos limites 23.0 e 35.0
            dev._simTemp += dev._simInc;
            if (dev._simTemp >= 35.0) {
                dev._simTemp = 35.0;
                dev._simInc = -0.5;
            } else if (dev._simTemp <= 23.0) {
                dev._simTemp = 23.0;
                dev._simInc = 0.5;
            }

            // Status e LED reativos
            const isCrit = l.temperatura < 15 || l.temperatura > 30 || l.umidade < 20 || l.umidade > 75 || l.co2 > 1200;
            const isWarn = l.temperatura < 18 || l.temperatura > 26 || l.umidade < 30 || l.umidade > 60 || l.co2 > 800;

            if (isCrit) {
                dev.led = 'Vermelho';
                dev.status = 'Crítico';
            } else if (isWarn) {
                dev.led = 'Amarelo';
                dev.status = 'Atenção';
            } else {
                dev.led = 'Verde';
                dev.status = 'Operacional';
            }

            // Atualização in-place de alta performance no card
            updateSingleSensorCardInPlace(dev);

            // Se o modal de detalhes estiver aberto neste dispositivo, atualiza os dados
            const modal = document.getElementById('sensorModal');
            if (modal && modal.classList.contains('active')) {
                const title = document.getElementById('modalSensorTitle')?.innerText || '';
                if (title.includes(dev.numero_serie)) {
                    updateOpenModalSimulatedValues(dev);
                }
            }
        }
    });

    if (hasSimulated) {
        setSensorLiveBadgeState(true);
        updateDashboardSummary(currentDevices);

        if (document.body.classList.contains('fullscreen-active')) {
            const activeDev = currentDevices[fsCarousel.getActiveIndex()];
            if (activeDev && (activeDev.isSimulated || (activeDev.numero_serie && activeDev.numero_serie.startsWith('LFG60-SIM')))) {
                renderFullscreenDevice(fsCarousel.getActiveIndex());
            }
        }
    }
}

function updateOpenModalSimulatedValues(dev) {
    const l = dev.ultima_leitura || {};
    const timestampStr = l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR') : 'Sem registros de leitura';
    const timeEl = document.getElementById('modalLastTimestamp');
    if (timeEl) timeEl.innerText = `Última Leitura: ${timestampStr}`;

    const led = dev.led || 'Green';
    const dot = document.getElementById('modalLedDot');
    const ledText = document.getElementById('modalLedText');
    const devStatus = document.getElementById('modalDeviceStatus');

    if (dot) {
        const isRed = led === 'Vermelho' || led === 'Red';
        const isYellow = led === 'Amarelo' || led === 'Yellow';
        dot.style.background = isRed ? '#dc2626' : (isYellow ? '#f59e0b' : '#10b981');
    }
    if (ledText) ledText.innerText = `LED Indicador: ${translateLed(led)}`;
    if (devStatus) devStatus.innerText = `Status Geral: ${translateStatus(dev.status)}`;

    const grid = document.getElementById('modalParamsGrid');
    if (grid) {
        grid.innerHTML = `
            ${renderParamCard('Temperatura', l.temperatura, '°C', '18.0 - 26.0 °C', l.temperatura < 18 || l.temperatura > 26)}
            ${renderParamCard('Umidade Relativa', l.umidade, '%', '30.0 - 60.0 %', l.umidade < 30 || l.umidade > 60)}
            ${renderParamCard('CO2', l.co2, 'ppm', '≤ 800 ppm', l.co2 > 800)}
            ${renderParamCard('PM2.5', l.pm25, 'µg/m³', '≤ 15 µg/m³', l.pm25 > 15)}
            ${renderParamCard('PM10', l.pm10, 'µg/m³', '≤ 30 µg/m³', l.pm10 > 30)}
            ${renderParamCard('VOC', l.voc, 'ppm', '≤ 0.20 ppm', l.voc > 0.20)}
            ${renderParamCard('Formaldeído', l.formaldeido, 'mg/m³', '≤ 0.05 mg/m³', l.formaldeido > 0.05)}
        `;
    }
}

function updateLfgDeviceSelect(devices) {
    const select = document.getElementById('lfgDeviceSelect');
    if (!select) return;

    const currentVal = select.value || 'all';
    let optionsHtml = '<option value="all">Todos os Transmissores</option>';
    devices.forEach(d => {
        optionsHtml += `<option value="${escapeHtml(d.numero_serie)}">Transmissor ${escapeHtml(d.numero_serie)}</option>`;
    });

    select.innerHTML = optionsHtml;
    if (devices.some(d => d.numero_serie === currentVal)) {
        select.value = currentVal;
    } else {
        select.value = 'all';
    }
}

function onSelectLfgDeviceChange() {
    const select = document.getElementById('lfgDeviceSelect');
    const container = document.getElementById('sensorListContainer');
    if (!select || !container) return;

    const selectedSerial = select.value;
    if (selectedSerial === 'all') {
        container.scrollTo({ left: 0, behavior: 'smooth' });
    } else {
        const cards = Array.from(container.querySelectorAll('.sensor-card'));
        const targetIndex = currentDevices.findIndex(d => d.numero_serie === selectedSerial);
        if (targetIndex >= 0 && cards[targetIndex]) {
            scrollCarouselToIndex(targetIndex);
            cards[targetIndex].style.transition = 'transform 0.3s ease, border-color 0.3s ease';
            cards[targetIndex].style.borderColor = '#0284c7';
            cards[targetIndex].style.transform = 'scale(1.02)';
            setTimeout(() => {
                cards[targetIndex].style.borderColor = '';
                cards[targetIndex].style.transform = '';
            }, 1200);
        }
    }
}

// ----------------------------------------------------
// CHART.JS GAUGES IN DEVICE CARDS
// ----------------------------------------------------
const activeManometros = {};

function getTemperatureGaugeColor(tempVal) {
    if (tempVal === null || tempVal === undefined || isNaN(tempVal)) return '#94a3b8';
    const cfg = currentLimites.temperatura || { min_ideal: 18, max_ideal: 26, crit_min: 15, crit_max: 30 };
    const minI = (cfg.min_ideal !== null && cfg.min_ideal !== undefined) ? Number(cfg.min_ideal) : 18;
    const maxI = (cfg.max_ideal !== null && cfg.max_ideal !== undefined) ? Number(cfg.max_ideal) : 26;
    const critMin = (cfg.crit_min !== null && cfg.crit_min !== undefined) ? Number(cfg.crit_min) : 15;
    const critMax = (cfg.crit_max !== null && cfg.crit_max !== undefined) ? Number(cfg.crit_max) : 30;

    if (tempVal >= minI && tempVal <= maxI) return '#10b981'; // Ideal Green
    if ((tempVal >= critMin && tempVal < minI) || (tempVal > maxI && tempVal <= critMax)) return '#f59e0b'; // Warning Yellow
    return '#ef4444'; // Critical Red
}

function getHumidityGaugeColor(umidVal) {
    if (umidVal === null || umidVal === undefined || isNaN(umidVal)) return '#94a3b8';
    const cfg = currentLimites.umidade || { min_ideal: 30, max_ideal: 60, crit_min: 20, crit_max: 75 };
    const minI = (cfg.min_ideal !== null && cfg.min_ideal !== undefined) ? Number(cfg.min_ideal) : 30;
    const maxI = (cfg.max_ideal !== null && cfg.max_ideal !== undefined) ? Number(cfg.max_ideal) : 60;
    const critMin = (cfg.crit_min !== null && cfg.crit_min !== undefined) ? Number(cfg.crit_min) : 20;
    const critMax = (cfg.crit_max !== null && cfg.crit_max !== undefined) ? Number(cfg.crit_max) : 75;

    if (umidVal >= minI && umidVal <= maxI) return '#0284c7'; // Ideal Ocean Blue
    if ((umidVal >= critMin && umidVal < minI) || (umidVal > maxI && umidVal <= critMax)) return '#f59e0b'; // Warning Yellow
    return '#ef4444'; // Critical Red
}

function initOrUpdateManometroGauge(canvasId, value, min, max, fillColor) {
    const val = value !== null && value !== undefined && !isNaN(value) ? Number(value) : min;
    const clamped = Math.max(min, Math.min(max, val));
    const progress = clamped - min;
    const remaining = max - clamped;

    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    if (activeManometros[canvasId]) {
        try {
            const chart = activeManometros[canvasId];
            if (chart && chart.canvas === canvas) {
                chart.data.datasets[0].data = [progress, remaining];
                chart.data.datasets[0].backgroundColor = [fillColor, '#e2e8f0'];
                chart.update('none');
                return;
            } else if (chart) {
                chart.destroy();
                delete activeManometros[canvasId];
            }
        } catch (e) {
            delete activeManometros[canvasId];
        }
    }

    try {
        const ctx = canvas.getContext('2d');
        activeManometros[canvasId] = new Chart(ctx, {
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
    } catch (chartErr) {
        console.warn('Error creating chart:', chartErr);
    }
}

function renderSensorCards(devices) {
    const container = document.getElementById('sensorListContainer');
    if (!container) return;

    if (devices.length === 0) {
        Object.keys(activeManometros).forEach(key => {
            if (activeManometros[key]) {
                activeManometros[key].destroy();
                delete activeManometros[key];
            }
        });
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: #888; width: 100%;">Nenhum transmissor cadastrado no banco de dados.</div>`;
        return;
    }

    const existingCards = container.querySelectorAll('.sensor-card');
    const hasMatchingDom = existingCards.length === devices.length && devices.every(d => document.getElementById(`sensor-card-${d.numero_serie}`));

    if (hasMatchingDom) {
        devices.forEach(dev => {
            const l = dev.ultima_leitura || {};
            const led = dev.led || 'Verde';
            const statusRaw = dev.status || 'Operacional';
            const isAlert = led === 'Amarelo' || led === 'Vermelho' || led === 'Yellow' || led === 'Red' || (statusRaw !== 'Operacional' && statusRaw !== 'Operational');

            const tempVal = l.temperatura !== null && l.temperatura !== undefined ? Number(l.temperatura) : null;
            const umidVal = l.umidade !== null && l.umidade !== undefined ? Number(l.umidade) : null;
            const co2Text = l.co2 !== null && l.co2 !== undefined ? `${l.co2} ppm` : '--';

            const tempDisplay = tempVal !== null ? `${tempVal.toFixed(1)}°C` : '--';
            const umidDisplay = umidVal !== null ? `${umidVal.toFixed(1)}%` : '--';

            const tempColor = getTemperatureGaugeColor(tempVal);
            const umidColor = getHumidityGaugeColor(umidVal);

            const cardEl = document.getElementById(`sensor-card-${dev.numero_serie}`);
            if (cardEl) {
                cardEl.className = `sensor-card ${isAlert ? 'alert' : ''}`;
            }

            const badgeEl = document.getElementById(`status-badge-${dev.numero_serie}`);
            if (badgeEl) {
                const isCrit = statusRaw === 'Crítico' || statusRaw === 'Critical';
                const isWarn = statusRaw === 'Atenção' || statusRaw === 'Warning';
                const statusClass = isCrit ? 'critico' : (isWarn ? 'atencao' : 'operacional');
                const dotClass = (led === 'Vermelho' || led === 'Red') ? 'red' : ((led === 'Amarelo' || led === 'Yellow') ? 'yellow' : 'green');
                const translatedSt = translateStatus(statusRaw);
                badgeEl.className = `header-status-badge ${statusClass}`;
                badgeEl.innerHTML = `<span class="status-dot ${dotClass}" title="LED: ${translateLed(led)}"></span><span>${translatedSt}</span>`;
            }

            const tempTextEl = document.getElementById(`temp-val-${dev.numero_serie}`);
            if (tempTextEl) {
                tempTextEl.innerText = tempDisplay;
                tempTextEl.style.color = tempColor;
            }

            const umidTextEl = document.getElementById(`umid-val-${dev.numero_serie}`);
            if (umidTextEl) {
                umidTextEl.innerText = umidDisplay;
                umidTextEl.style.color = umidColor;
            }

            const co2El = document.getElementById(`co2-val-${dev.numero_serie}`);
            if (co2El) co2El.innerText = co2Text;

            initOrUpdateManometroGauge(`gauge-temp-${dev.numero_serie}`, tempVal, 0, 50, tempColor);
            initOrUpdateManometroGauge(`gauge-umid-${dev.numero_serie}`, umidVal, 0, 100, umidColor);
        });

        const countPill = document.getElementById('devicesCountPill');
        if (countPill) {
            countPill.innerText = `${devices.length} dispositivo${devices.length !== 1 ? 's' : ''}`;
        }
        return;
    }

    Object.keys(activeManometros).forEach(key => {
        if (activeManometros[key]) {
            activeManometros[key].destroy();
            delete activeManometros[key];
        }
    });

    container.innerHTML = devices.map(dev => {
        const l = dev.ultima_leitura || {};
        const led = dev.led || 'Verde';
        const statusRaw = dev.status || 'Operacional';
        const isAlert = led === 'Amarelo' || led === 'Vermelho' || led === 'Yellow' || led === 'Red' || (statusRaw !== 'Operacional' && statusRaw !== 'Operational');
        
        const tempVal = l.temperatura !== null && l.temperatura !== undefined ? Number(l.temperatura) : null;
        const umidVal = l.umidade !== null && l.umidade !== undefined ? Number(l.umidade) : null;
        const co2Text = l.co2 !== null && l.co2 !== undefined ? `${l.co2} ppm` : '--';

        const tempDisplay = tempVal !== null ? `${tempVal.toFixed(1)}°C` : '--';
        const umidDisplay = umidVal !== null ? `${umidVal.toFixed(1)}%` : '--';

        const tempColor = getTemperatureGaugeColor(tempVal);
        const umidColor = getHumidityGaugeColor(umidVal);

        const isCrit = statusRaw === 'Crítico' || statusRaw === 'Critical';
        const isWarn = statusRaw === 'Atenção' || statusRaw === 'Warning';
        const statusClass = isCrit ? 'critico' : (isWarn ? 'atencao' : 'operacional');
        const dotClass = (led === 'Vermelho' || led === 'Red') ? 'red' : ((led === 'Amarelo' || led === 'Yellow') ? 'yellow' : 'green');
        const translatedSt = translateStatus(statusRaw);

        return `
            <div class="sensor-card ${isAlert ? 'alert' : ''}" id="sensor-card-${escapeHtml(dev.numero_serie)}" data-serie="${escapeHtml(dev.numero_serie)}" onclick="openDeviceDetailModal(this.dataset.serie)">
                <div class="sensor-header">
                    <h4>Transmissor ${escapeHtml(dev.numero_serie)}</h4>
                    <div class="header-status-badge ${statusClass}" id="status-badge-${escapeHtml(dev.numero_serie)}">
                        <span class="status-dot ${dotClass}" title="LED: ${translateLed(led)}"></span>
                        <span>${translatedSt}</span>
                    </div>
                </div>

                <div class="sensor-gauges-row">
                    <!-- Temperature Gauge -->
                    <div class="manometro-box">
                        <div class="manometro-canvas-wrapper">
                            <canvas id="gauge-temp-${escapeHtml(dev.numero_serie)}"></canvas>
                            <div class="manometro-center-info">
                                <span class="manometro-val" id="temp-val-${escapeHtml(dev.numero_serie)}" style="color: ${tempColor};">${tempDisplay}</span>
                                <span class="manometro-label">Temperature</span>
                            </div>
                        </div>
                        <div class="manometro-scale">
                            <span>0°C</span>
                            <span>50°C</span>
                        </div>
                        <div class="manometro-ideal-badge">Ideal: ${(escapeHtml(currentLimites.temperatura?.min_ideal ?? 18))}°C a ${(escapeHtml(currentLimites.temperatura?.max_ideal ?? 26))}°C</div>
                    </div>

                    <!-- Humidity Gauge -->
                    <div class="manometro-box">
                        <div class="manometro-canvas-wrapper">
                            <canvas id="gauge-umid-${escapeHtml(dev.numero_serie)}"></canvas>
                            <div class="manometro-center-info">
                                <span class="manometro-val" id="umid-val-${escapeHtml(dev.numero_serie)}" style="color: ${umidColor};">${umidDisplay}</span>
                                <span class="manometro-label">Umidade</span>
                            </div>
                        </div>
                        <div class="manometro-scale">
                            <span>0%</span>
                            <span>100%</span>
                        </div>
                        <div class="manometro-ideal-badge">Ideal: ${(escapeHtml(currentLimites.umidade?.min_ideal ?? 30))}% a ${(escapeHtml(currentLimites.umidade?.max_ideal ?? 60))}%</div>
                    </div>
                </div>

                <div class="sensor-card-footer">
                    <div class="sensor-extra-pill">
                        <span>CO2:</span>
                        <strong id="co2-val-${escapeHtml(dev.numero_serie)}">${co2Text}</strong>
                    </div>
                    <div class="sensor-details-hint">
                        <span>Ver detalhes</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const countPill = document.getElementById('devicesCountPill');
    if (countPill) {
        countPill.innerText = `${devices.length} dispositivo${devices.length !== 1 ? 's' : ''}`;
    }

    devices.forEach(dev => {
        const l = dev.ultima_leitura || {};
        const tempVal = l.temperatura !== null && l.temperatura !== undefined ? Number(l.temperatura) : null;
        const umidVal = l.umidade !== null && l.umidade !== undefined ? Number(l.umidade) : null;

        const tempColor = getTemperatureGaugeColor(tempVal);
        const umidColor = getHumidityGaugeColor(umidVal);

        initOrUpdateManometroGauge(`gauge-temp-${dev.numero_serie}`, tempVal, 0, 50, tempColor);
        initOrUpdateManometroGauge(`gauge-umid-${dev.numero_serie}`, umidVal, 0, 100, umidColor);
    });

    setTimeout(updateCarouselState, 50);
}

function updateDashboardSummary(devices) {
    const cardStatusGeral = document.getElementById('cardStatusGeral');
    const cardStatusGeralSub = document.getElementById('cardStatusGeralSub');
    const cardCountAtencao = document.getElementById('cardCountAtencao');

    let countAtencao = 0;
    let countCritico = 0;

    devices.forEach(d => {
        const led = d.led;
        const st = d.status;
        if (led === 'Amarelo' || led === 'Yellow' || st === 'Atenção' || st === 'Warning') countAtencao++;
        if (led === 'Vermelho' || led === 'Red' || st === 'Crítico' || st === 'Critical') countCritico++;
    });

    if (cardCountAtencao) cardCountAtencao.innerText = countAtencao + countCritico;

    if (cardStatusGeral) {
        if (countCritico > 0) {
            cardStatusGeral.innerText = 'Crítico';
            cardStatusGeral.style.color = '#dc2626';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = `${countCritico} transmissor(es) em estado crítico!`;
        } else if (countAtencao > 0) {
            cardStatusGeral.innerText = 'Atenção';
            cardStatusGeral.style.color = '#f59e0b';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = `${countAtencao} transmissor(es) fora da faixa ideal`;
        } else {
            cardStatusGeral.innerText = 'Operacional';
            cardStatusGeral.style.color = '#10b981';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = 'Todos os parâmetros dentro da faixa';
        }
    }
}

// ----------------------------------------------------
// 2. WARNINGS & ALERTS IN HEADER
// ----------------------------------------------------
// ----------------------------------------------------
// 3. DEVICE DETAIL MODAL
// ----------------------------------------------------
function openDeviceDetailModal(numeroSerie) {
    const dev = currentDevices.find(d => d.numero_serie === numeroSerie);
    if (!dev) return;

    const modal = document.getElementById('sensorModal');
    document.getElementById('modalSensorTitle').innerText = `Transmissor: ${dev.numero_serie}`;
    document.getElementById('modalLocationText').innerText = `Número de Série: ${dev.numero_serie}`;

    const l = dev.ultima_leitura || {};
    const timestampStr = l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR') : 'Sem registros de leitura';
    document.getElementById('modalLastTimestamp').innerText = `Última Leitura: ${timestampStr}`;

    const led = dev.led || 'Verde';
    const dot = document.getElementById('modalLedDot');
    const ledText = document.getElementById('modalLedText');
    const devStatus = document.getElementById('modalDeviceStatus');

    if (dot) {
        const isRed = led === 'Vermelho' || led === 'Red';
        const isYellow = led === 'Amarelo' || led === 'Yellow';
        dot.style.background = isRed ? '#dc2626' : (isYellow ? '#f59e0b' : '#10b981');
    }
    if (ledText) ledText.innerText = `LED Indicador: ${translateLed(led)}`;
    if (devStatus) devStatus.innerText = `Status Geral: ${translateStatus(dev.status)}`;

    // Render 7 Environmental Parameters
    const grid = document.getElementById('modalParamsGrid');
    if (grid) {
        const tCfg = currentLimites.temperatura || { min_ideal: 18, max_ideal: 26 };
        const uCfg = currentLimites.umidade || { min_ideal: 30, max_ideal: 60 };
        const co2Cfg = currentLimites.co2 || { max_ideal: 800 };
        const pm25Cfg = currentLimites.pm25 || { max_ideal: 15 };
        const pm10Cfg = currentLimites.pm10 || { max_ideal: 30 };
        const vocCfg = currentLimites.voc || { max_ideal: 0.20 };
        const formCfg = currentLimites.formaldeido || { max_ideal: 0.05 };

        const tMin = (tCfg.min_ideal !== null && tCfg.min_ideal !== undefined) ? Number(tCfg.min_ideal) : 18;
        const tMax = (tCfg.max_ideal !== null && tCfg.max_ideal !== undefined) ? Number(tCfg.max_ideal) : 26;
        const uMin = (uCfg.min_ideal !== null && uCfg.min_ideal !== undefined) ? Number(uCfg.min_ideal) : 30;
        const uMax = (uCfg.max_ideal !== null && uCfg.max_ideal !== undefined) ? Number(uCfg.max_ideal) : 60;
        const co2Max = (co2Cfg.max_ideal !== null && co2Cfg.max_ideal !== undefined) ? Number(co2Cfg.max_ideal) : 800;
        const pm25Max = (pm25Cfg.max_ideal !== null && pm25Cfg.max_ideal !== undefined) ? Number(pm25Cfg.max_ideal) : 15;
        const pm10Max = (pm10Cfg.max_ideal !== null && pm10Cfg.max_ideal !== undefined) ? Number(pm10Cfg.max_ideal) : 30;
        const vocMax = (vocCfg.max_ideal !== null && vocCfg.max_ideal !== undefined) ? Number(vocCfg.max_ideal) : 0.20;
        const formMax = (formCfg.max_ideal !== null && formCfg.max_ideal !== undefined) ? Number(formCfg.max_ideal) : 0.05;

        grid.innerHTML = `
            ${renderParamCard('Temperatura', l.temperatura, '°C', `${tMin.toFixed(1)} - ${tMax.toFixed(1)} °C`, l.temperatura !== null && (l.temperatura < tMin || l.temperatura > tMax))}
            ${renderParamCard('Umidade Relativa', l.umidade, '%', `${uMin.toFixed(1)} - ${uMax.toFixed(1)} %`, l.umidade !== null && (l.umidade < uMin || l.umidade > uMax))}
            ${renderParamCard('CO2', l.co2, 'ppm', `≤ ${co2Max} ppm`, l.co2 !== null && l.co2 > co2Max)}
            ${renderParamCard('PM2.5', l.pm25, 'µg/m³', `≤ ${pm25Max.toFixed(1)} µg/m³`, l.pm25 !== null && l.pm25 > pm25Max)}
            ${renderParamCard('PM10', l.pm10, 'µg/m³', `≤ ${pm10Max.toFixed(1)} µg/m³`, l.pm10 !== null && l.pm10 > pm10Max)}
            ${renderParamCard('VOC', l.voc, 'ppm', `≤ ${vocMax.toFixed(2)} ppm`, l.voc !== null && l.voc > vocMax)}
            ${renderParamCard('Formaldeído', l.formaldeido, 'mg/m³', `≤ ${formMax.toFixed(2)} mg/m³`, l.formaldeido !== null && l.formaldeido > formMax)}
        `;
    }

    fetchDeviceHistory(numeroSerie);

    modal.classList.add('active');

    const coords = numeroSerie.includes('SP') ? [-23.5505, -46.6333] : (numeroSerie.includes('RJ') ? [-22.9068, -43.1729] : [-19.9167, -43.9345]);
    setTimeout(() => {
        if (!mapInstance) {
            mapInstance = L.map('map').setView(coords, 14);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; OpenStreetMap &copy; CARTO'
            }).addTo(mapInstance);
        } else {
            mapInstance.setView(coords, 14);
            mapInstance.invalidateSize();
        }
    }, 300);
}

async function fetchDeviceHistory(numeroSerie) {
    const historyContainer = document.getElementById('modalHistoryContainer');
    if (!historyContainer) return;

    if (numeroSerie.startsWith('LFG60-SIM')) {
        const mockHistory = [];
        const now = Date.now();
        for (let i = 0; i < 15; i++) {
            const t = new Date(now - i * 60000);
            const temp = Number((23.0 + (i * 0.8) % 12.0).toFixed(1));
            const umid = 55.0;
            const co2 = 450;
            const isWarn = temp < 18 || temp > 26;
            const isCrit = temp < 15 || temp > 30;
            const itemLed = isCrit ? 'Red' : (isWarn ? 'Yellow' : 'Green');
            mockHistory.push({
                timestamp_leitura: t.toISOString(),
                led: itemLed,
                temperatura: temp,
                umidade: umid,
                co2: co2
            });
        }
        historyContainer.innerHTML = mockHistory.map(item => {
            const time = new Date(item.timestamp_leitura).toLocaleString('pt-BR');
            const ledColor = item.led === 'Red' ? '#ef4444' : (item.led === 'Yellow' ? '#f59e0b' : '#10b981');
            return `
                <div style="padding: 6px 0; border-bottom: 1px dashed #334155; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                    <div>
                        <span style="color: ${ledColor}; font-weight: bold;">● [${escapeHtml(item.led)}]</span> 
                        <span style="color: #94a3b8;">${time}</span>
                    </div>
                    <div style="text-align: right; color: #e2e8f0;">
                        Temp: <strong>${escapeHtml(item.temperatura)}°C</strong> | 
                        Umidade: <strong>${escapeHtml(item.umidade)}%</strong> | 
                        CO2: <strong>${escapeHtml(item.co2)} ppm</strong>
                    </div>
                </div>
            `;
        }).join('');
        return;
    }

    historyContainer.innerHTML = `<div style="color: #94a3b8;">Carregando histórico do banco de dados...</div>`;

    try {
        const res = await fetch(`${API_BASE}/api/lfg60/${numeroSerie}/leituras`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('Error fetching readings history.');
        const result = await res.json();

        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
            historyContainer.innerHTML = result.data.map(item => {
                const time = item.timestamp_leitura ? new Date(item.timestamp_leitura).toLocaleString('pt-BR') : (item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : 'N/A');
                const isRed = item.led === 'Vermelho' || item.led === 'Red';
                const isYellow = item.led === 'Amarelo' || item.led === 'Yellow';
                const ledColor = isRed ? '#ef4444' : (isYellow ? '#f59e0b' : '#10b981');
                return `
                    <div style="padding: 6px 0; border-bottom: 1px dashed #334155; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                        <div>
                            <span style="color: ${ledColor}; font-weight: bold;">● [${translateLed(item.led)}]</span> 
                            <span style="color: #94a3b8;">${time}</span>
                        </div>
                        <div style="text-align: right; color: #e2e8f0;">
                            Temp: <strong>${item.temperatura !== null ? item.temperatura + '°C' : '--'}</strong> | 
                            Umidade: <strong>${item.umidade !== null ? item.umidade + '%' : '--'}</strong> | 
                            CO2: <strong>${item.co2 !== null ? item.co2 + ' ppm' : '--'}</strong>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            historyContainer.innerHTML = `<div style="color: #94a3b8;">Nenhum registro histórico encontrado.</div>`;
        }
    } catch (err) {
        console.warn('[LFG60] Error loading history:', err.message);
        historyContainer.innerHTML = `<div style="color: #ef4444;">Erro ao carregar o histórico da API.</div>`;
    }
}

function renderParamCard(label, val, unit, rangeStr, isOut) {
    const displayVal = val !== null && val !== undefined ? `${val} ${unit}` : '--';
    const cardClass = isOut ? 'param-card-mini warning' : 'param-card-mini';
    return `
        <div class="${cardClass}">
            <span class="param-label">${label}</span>
            <span class="param-val" style="${isOut ? 'color:#dc2626;' : ''}">${displayVal}</span>
            <span class="param-range-sub">Ideal: ${rangeStr}</span>
        </div>
    `;
}

function closeSensorModal() {
    const modal = document.getElementById('sensorModal');
    if (modal) modal.classList.remove('active');
}

// ----------------------------------------------------
// 4. PRESCRIBED RANGES AND LIMITS MODAL
// ----------------------------------------------------
async function openPrescribedRangesModal() {
    const modal = document.getElementById('rangesModal');
    const tbody = document.getElementById('rangesTableBody');
    if (!modal || !tbody) return;

    try {
        const res = await fetch(`${API_BASE}/api/lfg60/limites`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('Error fetching limits');
        const limites = await res.json();
        
        let html = '';
        const order = ['temperatura', 'umidade', 'co2', 'pm25', 'pm10', 'voc', 'formaldeido'];
        order.forEach(key => {
            const l = limites[key];
            if (!l) return;
            
            // Apenas temperatura e umidade possuem faixa com mínimo e máximo ideal.
            // Os demais (CO2, partículas, VOC, formaldeído) possuem apenas teto ideal e teto de aviso.
            const hasMin = (key === 'temperatura' || key === 'umidade') || (l.min_ideal !== null && l.min_ideal !== undefined);
            const step = (key === 'voc' || key === 'formaldeido') ? '0.01' : '0.1';
            const inputStyle = 'width: 55px; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 4px; padding: 4px 2px; text-align: center; font-size: 12px; margin: 0 2px;';
            const translatedLabel = translateParamKey(key);

            const minIdealVal = (l.min_ideal !== null && l.min_ideal !== undefined) ? l.min_ideal : '';
            const maxIdealVal = (l.max_ideal !== null && l.max_ideal !== undefined) ? l.max_ideal : '';
            const maxAvisoVal = (l.max_aviso !== null && l.max_aviso !== undefined) ? l.max_aviso : '';
            const critMinVal = (l.crit_min !== null && l.crit_min !== undefined) ? l.crit_min : '';
            const critMaxVal = (l.crit_max !== null && l.crit_max !== undefined) ? l.crit_max : '';
            
            html += `
            <tr data-param="${key}">
                <td style="white-space: nowrap;"><strong>${translatedLabel}</strong></td>
                <td>${escapeHtml(l.unit)}</td>
                <td style="white-space: nowrap;">
                    ${hasMin ? 
                        `<input type="number" step="${step}" class="input-limite" data-field="min_ideal" value="${minIdealVal}" style="${inputStyle}"> a 
                         <input type="number" step="${step}" class="input-limite" data-field="max_ideal" value="${maxIdealVal}" style="${inputStyle}">` 
                        : 
                        `&le; <input type="number" step="${step}" class="input-limite" data-field="max_ideal" value="${maxIdealVal}" style="${inputStyle}">`
                    }
                </td>
                <td style="color: #f59e0b; white-space: nowrap; font-size: 12px;">
                    ${hasMin ? 
                        `Fora do Ideal` 
                        : 
                        `Até <input type="number" step="${step}" class="input-limite" data-field="max_aviso" value="${maxAvisoVal}" style="${inputStyle}">`
                    }
                </td>
                <td style="color: #ef4444; white-space: nowrap; font-size: 12px;">
                    ${hasMin ? 
                        `&lt; <input type="number" step="${step}" class="input-limite" data-field="crit_min" value="${critMinVal}" style="${inputStyle}"> ou 
                         &gt; <input type="number" step="${step}" class="input-limite" data-field="crit_max" value="${critMaxVal}" style="${inputStyle}">` 
                        : 
                        `&gt; Aviso Máx.`
                    }
                </td>
            </tr>
            `;
        });
        tbody.innerHTML = html;
        
        modal.classList.add('active');
    } catch (e) {
        console.error('Error opening limits modal:', e);
        alert('Erro ao carregar os limites do banco de dados.');
    }
}

function closeRangesModal() {
    const modal = document.getElementById('rangesModal');
    if (modal) modal.classList.remove('active');
}

async function savePrescribedRanges() {
    const tbody = document.getElementById('rangesTableBody');
    if (!tbody) return;
    
    const novosLimites = {};
    const rows = tbody.querySelectorAll('tr[data-param]');
    
    rows.forEach(row => {
        const param = row.getAttribute('data-param');
        novosLimites[param] = {};
        
        const inputs = row.querySelectorAll('.input-limite');
        inputs.forEach(input => {
            const field = input.getAttribute('data-field');
            const rawVal = (input.value || '').trim().replace(',', '.');
            if (rawVal === '') {
                novosLimites[param][field] = null;
            } else {
                const num = parseFloat(rawVal);
                novosLimites[param][field] = isNaN(num) ? null : num;
            }
        });
    });
    
    try {
        const res = await fetch(`${API_BASE}/api/lfg60/limites`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(novosLimites)
        });
        
        if (res.ok) {
            // Atualiza o estado em memória local imediatamente
            Object.keys(novosLimites).forEach(param => {
                if (!currentLimites[param]) currentLimites[param] = {};
                Object.assign(currentLimites[param], novosLimites[param]);
            });

            alert('Limites atualizados com sucesso!');
            closeRangesModal();
            await loadDashboardData();
        } else {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData.error || errData.erro || errData.message || `Erro ao atualizar limites (${res.status})`;
            console.error('[LFG60] API error updating limits:', errMsg);
            alert(`Erro ao atualizar limites: ${errMsg}`);
        }
    } catch (e) {
        console.error('Error saving limits:', e);
        alert(`Erro de conexão com a API: ${e.message || e}`);
    }
}

document.addEventListener('click', function(e) {
    const sensorModal = document.getElementById('sensorModal');
    const rangesModal = document.getElementById('rangesModal');

    if (sensorModal && e.target === sensorModal) closeSensorModal();
    if (rangesModal && e.target === rangesModal) closeRangesModal();
});

// toggleNavDropdown e toggleFullscreen são providos por config.js e shared/ui/fullscreen-presenter.js

// ----------------------------------------------------
// 6. FULLSCREEN UNITARY PRESENTATION (KIOSK / TV)
// ----------------------------------------------------

function getParamEvaluation(param, val) {
    if (val === null || val === undefined || isNaN(val)) {
        return { text: 'N/A', cls: 'ideal' };
    }
    const v = Number(val);
    const cfg = currentLimites[param];
    if (!cfg) return { text: 'Normal', cls: 'ideal' };

    const hasMin = (param === 'temperatura' || param === 'umidade') || (cfg.min_ideal !== null && cfg.min_ideal !== undefined);
    if (hasMin) {
        const minI = (cfg.min_ideal !== null && cfg.min_ideal !== undefined) ? Number(cfg.min_ideal) : 0;
        const maxI = (cfg.max_ideal !== null && cfg.max_ideal !== undefined) ? Number(cfg.max_ideal) : 0;
        const critMin = (cfg.crit_min !== null && cfg.crit_min !== undefined) ? Number(cfg.crit_min) : -999;
        const critMax = (cfg.crit_max !== null && cfg.crit_max !== undefined) ? Number(cfg.crit_max) : 999;

        if (v >= minI && v <= maxI) return { text: 'Ideal', cls: 'ideal' };
        if ((v >= critMin && v < minI) || (v > maxI && v <= critMax)) return { text: 'Atenção', cls: 'aviso' };
        return { text: 'Crítico', cls: 'critico' };
    } else {
        const maxI = (cfg.max_ideal !== null && cfg.max_ideal !== undefined) ? Number(cfg.max_ideal) : 0;
        const maxA = (cfg.max_aviso !== null && cfg.max_aviso !== undefined) ? Number(cfg.max_aviso) : maxI;

        if (v <= maxI) return { text: 'Normal', cls: 'ideal' };
        if (v <= maxA) return { text: 'Atenção', cls: 'aviso' };
        return { text: 'Crítico', cls: 'critico' };
    }
}

function renderFullscreenEmptyState() {
    fsCarousel.setActiveIndex(0);

    const titleEl = document.getElementById('fsDeviceTitle');
    if (titleEl) titleEl.innerText = 'Transmissor --';

    const statusPill = document.getElementById('fsStatusPill');
    const statusText = document.getElementById('fsStatusText');
    if (statusPill && statusText) {
        statusPill.className = 'fs-status-pill operacional';
        statusText.innerText = 'Standby (Sem Dados)';
    }

    const ledDot = document.getElementById('fsLedDot');
    const ledText = document.getElementById('fsLedText');
    if (ledDot && ledText) {
        ledDot.className = 'fs-led-dot green';
        ledText.innerText = 'LED: --';
    }

    const lastTimeEl = document.getElementById('fsLastReadingTime');
    if (lastTimeEl) lastTimeEl.innerText = 'Nenhum transmissor LFG60 vinculado';

    const tempValEl = document.getElementById('fsTempVal');
    if (tempValEl) {
        tempValEl.innerText = '--';
        tempValEl.style.color = '#64748b';
    }
    const tempChipEl = document.getElementById('fsTempChip');
    if (tempChipEl) {
        tempChipEl.className = 'fs-gauge-chip ideal';
        tempChipEl.innerText = 'Sem Dados';
    }

    const umidValEl = document.getElementById('fsUmidVal');
    if (umidValEl) {
        umidValEl.innerText = '--';
        umidValEl.style.color = '#64748b';
    }
    const umidChipEl = document.getElementById('fsUmidChip');
    if (umidChipEl) {
        umidChipEl.className = 'fs-gauge-chip ideal';
        umidChipEl.innerText = 'Sem Dados';
    }

    updateFsGaugeChart(0, 0, 50, '#e2e8f0', 'fsGaugeTempCanvas', 6);
    updateFsGaugeChart(0, 0, 100, '#e2e8f0', 'fsGaugeUmidCanvas', 6);

    ['co2', 'pm25', 'pm10', 'voc', 'formaldeido'].forEach(p => {
        updateFsVarCard(p, null, () => '--', p);
    });

    const diagLed = document.getElementById('fsDiagLedVal');
    if (diagLed) {
        diagLed.innerText = '--';
        diagLed.style.color = '#64748b';
    }
    const diagEval = document.getElementById('fsDiagEvaluation');
    const diagBadge = document.getElementById('fsStatus-diag');
    if (diagEval && diagBadge) {
        diagBadge.className = 'fs-param-status estavel';
        diagBadge.innerText = 'Aguardando';
        diagEval.innerText = 'Aguardando vinculação de transmissor';
        diagEval.style.color = '#64748b';
    }

    fsCarousel.renderFsDots();
    const counterEl = document.getElementById('fsDeviceCounterText');
    if (counterEl) counterEl.innerText = 'Nenhum transmissor LFG60 vinculado';

    const select = document.getElementById('fsDeviceSelect');
    if (select) select.innerHTML = '<option value="">Nenhum transmissor disponível</option>';
}

function renderFullscreenDevice(index) {
    if (!currentDevices || currentDevices.length === 0) {
        renderFullscreenEmptyState();
        return;
    }

    index = fsCarousel.setActiveIndex(index);

    const dev = currentDevices[index];
    const l = dev.ultima_leitura || {};

    // 1. Update Device Header
    const titleEl = document.getElementById('fsDeviceTitle');
    if (titleEl) titleEl.innerText = `Transmissor ${dev.numero_serie}`;

    const statusPill = document.getElementById('fsStatusPill');
    const statusText = document.getElementById('fsStatusText');
    const stRaw = dev.status || 'Operacional';
    if (statusPill && statusText) {
        const isCrit = stRaw === 'Crítico' || stRaw === 'Critical';
        const isWarn = stRaw === 'Atenção' || stRaw === 'Warning';
        const statusClass = isCrit ? 'critico' : (isWarn ? 'atencao' : 'operacional');
        statusPill.className = `fs-status-pill ${statusClass}`;
        statusText.innerText = translateStatus(stRaw);
    }

    const ledDot = document.getElementById('fsLedDot');
    const ledText = document.getElementById('fsLedText');
    const led = dev.led || 'Verde';
    if (ledDot && ledText) {
        const isRed = led === 'Vermelho' || led === 'Red';
        const isYellow = led === 'Amarelo' || led === 'Yellow';
        const dotClass = isRed ? 'red' : (isYellow ? 'yellow' : 'green');
        ledDot.className = `fs-led-dot ${dotClass}`;
        ledText.innerText = `LED: ${translateLed(led)}`;
    }

    const lastTimeEl = document.getElementById('fsLastReadingTime');
    if (lastTimeEl) {
        const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR') : 'Aguardando primeira leitura';
        lastTimeEl.innerText = `Última Leitura: ${timeStr}`;
    }

    // 2. Temperature and Humidity Gauges
    const tempVal = (l.temperatura !== null && l.temperatura !== undefined) ? Number(l.temperatura) : null;
    const umidVal = (l.umidade !== null && l.umidade !== undefined) ? Number(l.umidade) : null;

    const tempDisplay = tempVal !== null ? `${tempVal.toFixed(1)}` : '--';
    const umidDisplay = umidVal !== null ? `${umidVal.toFixed(1)}` : '--';

    const tempColor = getTemperatureGaugeColor(tempVal);
    const umidColor = getHumidityGaugeColor(umidVal);

    const tempEval = getParamEvaluation('temperatura', tempVal);
    const umidEval = getParamEvaluation('umidade', umidVal);

    const tempValEl = document.getElementById('fsTempVal');
    if (tempValEl) {
        tempValEl.innerText = tempDisplay;
        tempValEl.style.color = tempColor;
    }
    const tempChipEl = document.getElementById('fsTempChip');
    if (tempChipEl) {
        tempChipEl.className = `fs-gauge-chip ${tempEval.cls}`;
        tempChipEl.innerText = tempEval.text;
    }

    const umidValEl = document.getElementById('fsUmidVal');
    if (umidValEl) {
        umidValEl.innerText = umidDisplay;
        umidValEl.style.color = umidColor;
    }
    const umidChipEl = document.getElementById('fsUmidChip');
    if (umidChipEl) {
        umidChipEl.className = `fs-gauge-chip ${umidEval.cls}`;
        umidChipEl.innerText = umidEval.text;
    }

    // 2.1 Atualiza legendas de range ideal dos manômetros em tela cheia
    const tCfg = currentLimites.temperatura || { min_ideal: 18, max_ideal: 26 };
    const uCfg = currentLimites.umidade || { min_ideal: 30, max_ideal: 60 };
    const fsGaugeRanges = document.querySelectorAll('.fs-gauge-range');
    if (fsGaugeRanges[0]) fsGaugeRanges[0].innerText = `Faixa Ideal: ${(tCfg.min_ideal ?? 18)}°C a ${(tCfg.max_ideal ?? 26)}°C`;
    if (fsGaugeRanges[1]) fsGaugeRanges[1].innerText = `Faixa Ideal: ${(uCfg.min_ideal ?? 30)}% a ${(uCfg.max_ideal ?? 60)}%`;
    const fsGaugeMids = document.querySelectorAll('.fs-gauge-scale-mid');
    if (fsGaugeMids[0]) fsGaugeMids[0].innerText = `Faixa Ideal: ${(tCfg.min_ideal ?? 18)}° a ${(tCfg.max_ideal ?? 26)}°C`;
    if (fsGaugeMids[1]) fsGaugeMids[1].innerText = `Faixa Ideal: ${(uCfg.min_ideal ?? 30)}% a ${(uCfg.max_ideal ?? 60)}%`;

    updateFsGaugeChart(tempVal, 0, 50, tempColor, 'fsGaugeTempCanvas', 6);
    updateFsGaugeChart(umidVal, 0, 100, umidColor, 'fsGaugeUmidCanvas', 6);

    // 3. Other Environmental Parameters
    updateFsVarCard('co2', l.co2, val => val !== null && val !== undefined ? String(val) : '--', 'co2');
    updateFsVarCard('pm25', l.pm25, val => val !== null && val !== undefined ? Number(val).toFixed(1) : '--', 'pm25');
    updateFsVarCard('pm10', l.pm10, val => val !== null && val !== undefined ? Number(val).toFixed(1) : '--', 'pm10');
    updateFsVarCard('voc', l.voc, val => val !== null && val !== undefined ? Number(val).toFixed(2) : '--', 'voc');
    updateFsVarCard('formaldeido', l.formaldeido, val => val !== null && val !== undefined ? Number(val).toFixed(3) : '--', 'formaldeido');

    // 4. Overall Diagnostics Card
    const diagLed = document.getElementById('fsDiagLedVal');
    if (diagLed) {
        diagLed.innerText = translateLed(led);
        const isRed = led === 'Vermelho' || led === 'Red';
        const isYellow = led === 'Amarelo' || led === 'Yellow';
        diagLed.style.color = isRed ? '#ef4444' : (isYellow ? '#f59e0b' : '#10b981');
    }

    const diagEval = document.getElementById('fsDiagEvaluation');
    const diagBadge = document.getElementById('fsStatus-diag');
    let outCount = 0;
    ['temperatura', 'umidade', 'co2', 'pm25', 'pm10', 'voc', 'formaldeido'].forEach(p => {
        const ev = getParamEvaluation(p, l[p]);
        if (ev.cls !== 'ideal') outCount++;
    });

    if (diagEval && diagBadge) {
        if (outCount === 0) {
            diagBadge.className = 'fs-param-status estavel';
            diagBadge.innerText = 'Estável';
            diagEval.innerText = 'Todos os 7 parâmetros em conformidade';
            diagEval.style.color = '#059669';
        } else {
            diagBadge.className = 'fs-param-status aviso';
            diagBadge.innerText = 'Atenção';
            diagEval.innerText = `${outCount} parâmetro(s) fora da faixa ideal`;
            diagEval.style.color = '#d97706';
        }
    }

    // 5. Update Indicators (Dots) and Counter
    fsCarousel.renderFsDots();
    const counterEl = document.getElementById('fsDeviceCounterText');
    if (counterEl) {
        counterEl.innerText = `Transmissor ${fsCarousel.getActiveIndex() + 1} de ${currentDevices.length}`;
    }

    // 6. Synchronize Select
    const select = document.getElementById('fsDeviceSelect');
    if (select && select.value !== dev.numero_serie) {
        select.value = dev.numero_serie;
    }
}

function updateFsVarCard(paramKey, rawVal, formatFn, evalKey) {
    const valEl = document.getElementById(`fsVal-${paramKey}`);
    const statusEl = document.getElementById(`fsStatus-${paramKey}`);
    const cardEl = document.getElementById(`fsCard-${paramKey}`);

    const displayVal = formatFn(rawVal);
    const evaluation = getParamEvaluation(evalKey, rawVal);

    if (valEl) valEl.innerText = displayVal;
    if (statusEl) {
        statusEl.className = `fs-param-status ${evaluation.cls}`;
        statusEl.innerText = evaluation.text;
    }
    if (cardEl) {
        if (evaluation.cls === 'critico') {
            cardEl.style.borderColor = '#fecaca';
        } else if (evaluation.cls === 'aviso') {
            cardEl.style.borderColor = '#fde68a';
        } else {
            cardEl.style.borderColor = '#e2e8f0';
        }

        const footerSpan = cardEl.querySelector('.fs-param-footer span');
        if (footerSpan && currentLimites[evalKey] && currentLimites[evalKey].max_ideal !== undefined && currentLimites[evalKey].max_ideal !== null) {
            footerSpan.innerHTML = `Faixa Ideal: &le; ${currentLimites[evalKey].max_ideal} ${currentLimites[evalKey].unit || ''}`;
        }
    }
}

function updateFullscreenTelemetry() {
    if (!currentDevices || currentDevices.length === 0) {
        renderFullscreenEmptyState();
        return;
    }
    fsCarousel.populateFsDeviceSelect();
    renderFullscreenDevice(fsCarousel.getActiveIndex());
}

// ----------------------------------------------------
// 7. LFG60 DEVICES CAROUSEL CONTROLS
// ----------------------------------------------------
function scrollCarousel(direction) {
    const container = document.getElementById('sensorListContainer');
    if (!container) return;
    const card = container.querySelector('.sensor-card');
    const scrollAmount = card ? (card.offsetWidth + 16) : 340;
    container.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
}

function scrollCarouselToIndex(index) {
    const container = document.getElementById('sensorListContainer');
    if (!container) return;
    const cards = container.querySelectorAll('.sensor-card');
    if (cards[index]) {
        cards[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
}

let carouselScrollTimer = null;
function handleCarouselScroll() {
    if (carouselScrollTimer) clearTimeout(carouselScrollTimer);
    carouselScrollTimer = setTimeout(updateCarouselState, 50);
}

function updateCarouselState() {
    const container = document.getElementById('sensorListContainer');
    const btnPrev = document.getElementById('btnCarouselPrev');
    const btnNext = document.getElementById('btnCarouselNext');
    const indicatorsContainer = document.getElementById('carouselIndicators');
    const controls = document.getElementById('carouselControls');
    if (!container) return;

    const scrollLeft = container.scrollLeft;
    const maxScroll = container.scrollWidth - container.clientWidth;
    const hasOverflow = container.scrollWidth > (container.clientWidth + 8);

    if (btnPrev) btnPrev.disabled = scrollLeft <= 4;
    if (btnNext) btnNext.disabled = scrollLeft >= (maxScroll - 4);

    const cards = container.querySelectorAll('.sensor-card');
    if (controls) {
        controls.style.display = (cards.length > 0 && hasOverflow) ? 'flex' : 'none';
    }

    if (indicatorsContainer && cards.length > 1 && hasOverflow) {
        indicatorsContainer.innerHTML = '';
        const cardWidth = cards[0].offsetWidth + 16;
        const activeIndex = Math.min(cards.length - 1, Math.max(0, Math.round(scrollLeft / cardWidth)));

        cards.forEach((_, idx) => {
            const dot = document.createElement('div');
            dot.className = `indicator-dot ${idx === activeIndex ? 'active' : ''}`;
            dot.title = `Ir para o transmissor ${idx + 1}`;
            dot.onclick = () => scrollCarouselToIndex(idx);
            indicatorsContainer.appendChild(dot);
        });
    } else if (indicatorsContainer && (!hasOverflow || cards.length <= 1)) {
        indicatorsContainer.innerHTML = '';
    }
}
