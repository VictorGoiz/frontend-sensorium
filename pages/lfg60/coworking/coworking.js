/**
 * ============================================================================
 * SENSIMONITOR - LFG60 COWORKING CLIENT (3º ANDAR)
 * Lógica da Página e Apresentação de Tela Cheia Corporativa
 * ============================================================================
 */

let mapInstance = null;
let currentDevices = [];
let currentAlerts = [];
let activeAlertFilter = 'todos';

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

let lastProcessedReadingSignature = '';
let sensorBadgeWatchdog = null;
let liveClockInterval = null;

const USE_SIMULATED_LFG60 = false;
const SIMULATED_LFG60_DEVICES = [
    {
        numero_serie: 'LFG60-CW-01',
        nome: 'Espaço Coworking - 3º Andar (Principal)',
        cliente: 'Coworking Corporativo',
        status: 'Operational',
        led: 'Green',
        isSimulated: true,
        ultima_leitura: {
            temperatura: 22.8,
            umidade: 52.0,
            co2: 520,
            pm25: 8.4,
            pm10: 15.2,
            voc: 0.11,
            formaldeido: 0.015,
            timestamp: new Date().toISOString()
        }
    }
];

/**
 * Tradutores e Auxiliares
 */
function translateLed(led) {
    if (!led) return 'Verde';
    const l = String(led).toLowerCase();
    if (l === 'vermelho' || l === 'red') return 'Vermelho';
    if (l === 'amarelo' || l === 'yellow') return 'Amarelo';
    if (l === 'verde' || l === 'green') return 'Verde';
    return led;
}

function translateStatus(st) {
    if (!st) return 'Operacional';
    const s = String(st).toLowerCase();
    if (s === 'operacional' || s === 'operational') return 'Operacional';
    if (s === 'atenção' || s === 'atencao' || s === 'warning') return 'Atenção';
    if (s === 'crítico' || s === 'critico' || s === 'critical') return 'Crítico';
    if (s === 'normal') return 'Normal';
    return st;
}

function translateParamKey(param) {
    const map = {
        'temperatura': 'Temperatura Ambiente',
        'umidade': 'Umidade Relativa',
        'co2': 'Dióxido de Carbono (CO₂)',
        'pm25': 'Partículas Finas (PM2.5)',
        'pm10': 'Partículas Inaláveis (PM10)',
        'voc': 'Compostos Orgânicos (VOC)',
        'formaldeido': 'Formaldeído (HCHO)'
    };
    return map[param] || param;
}

function setSensorLiveBadgeState(isLive) {
    const badge = document.getElementById('livePresentationBadge');
    const badgeText = document.getElementById('liveBadgeText');
    const fsLiveBadge = document.getElementById('fsLiveBadge');
    const cwLiveStatusText = document.getElementById('cwLiveStatusText');

    if (badge) {
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

    if (fsLiveBadge) {
        if (isLive) {
            fsLiveBadge.classList.add('active');
            if (cwLiveStatusText) cwLiveStatusText.innerText = 'AO VIVO';
        } else {
            fsLiveBadge.classList.remove('active');
            if (cwLiveStatusText) cwLiveStatusText.innerText = 'AGUARDANDO';
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

    // Inicia Relógio Corporativo em Tempo Real
    startLiveClock();

    // Carrega dados iniciais
    loadDashboardData();

    // Conecta via WebSocket
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

        socket.on('sensor_reading', (data) => {
            handleLiveSensorReading(data);
        });

        socket.on('dashboard_update', (data) => {
            if (data?.data && data.type === 'sensor_data') {
                handleLiveSensorReading(data.data);
            } else {
                triggerDashboardUpdate(data);
            }
        });

        socket.on('disconnect', () => {
            setSensorLiveBadgeState(false);
        });

        setInterval(loadDashboardData, 15000);
    } else {
        setInterval(loadDashboardData, 10000);
    }

    // Ouvintes de Tela Cheia
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    // Carrossel fora de tela cheia
    const container = document.getElementById('sensorListContainer');
    if (container) {
        container.addEventListener('scroll', handleCarouselScroll);
    }
    window.addEventListener('resize', updateCarouselState);

    // Fechar popover de alertas ao clicar fora
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

// ============================================================================
// RELÓGIO CORPORATIVO EM TEMPO REAL
// ============================================================================
function startLiveClock() {
    updateClockDisplay();
    if (liveClockInterval) clearInterval(liveClockInterval);
    liveClockInterval = setInterval(updateClockDisplay, 1000);
}

function updateClockDisplay() {
    const timeEl = document.getElementById('cwLiveClock');
    const dateEl = document.getElementById('cwLiveDate');
    if (!timeEl && !dateEl) return;

    const now = new Date();
    
    // Hora formato 24h: HH:MM:SS
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');
    if (timeEl) timeEl.innerText = `${hours}:${mins}:${secs}`;

    // Data por extenso: "Quarta-feira, 14 de Outubro"
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
// CARREGAMENTO DE DADOS (API / LIMITES / DISPOSITIVOS)
// ============================================================================
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
        console.warn('[Coworking] Erro ao buscar limites prescritos da API:', e.message);
    }
}

async function loadDashboardData() {
    await Promise.all([
        fetchLimitesFromApi(),
        fetchDevicesFromApi(),
        fetchAlertsFromApi()
    ]);
}

function getAuthHeaders() {
    const token = localStorage.getItem('sensorium_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function fetchDevicesFromApi() {
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
            console.warn('[Coworking] API fetch warning:', apiErr.message);
        }

        if (loadedData !== null && loadedData.length > 0) {
            currentDevices = loadedData;
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
        console.warn('[Coworking] Error loading sensors:', err.message);
        currentDevices = [];
        updateLfgDeviceSelect(currentDevices);
        renderSensorCards(currentDevices);
        updateDashboardSummary(currentDevices);
        if (document.body.classList.contains('fullscreen-active')) {
            updateFullscreenTelemetry();
        }
        setSensorLiveBadgeState(false);
    }
}

function handleLiveSensorReading(reading) {
    if (!reading || !reading.numeroSerie) return;

    const { numeroSerie, temperatura, umidade, co2, pm25, pm10, voc, formaldeido, led, status, timestamp } = reading;

    const sig = `${numeroSerie}_${timestamp}_${temperatura}_${umidade}_${co2}`;
    if (lastProcessedReadingSignature === sig) return;
    lastProcessedReadingSignature = sig;

    setSensorLiveBadgeState(true);

    const dev = currentDevices.find(d => d.numero_serie === numeroSerie);
    if (!dev) {
        loadDashboardData();
        return;
    }

    dev.ultima_leitura = {
        temperatura: temperatura ?? null,
        umidade: umidade ?? null,
        co2: co2 ?? null,
        pm25: pm25 ?? null,
        pm10: pm10 ?? null,
        voc: voc ?? null,
        formaldeido: formaldeido ?? null,
        timestamp: timestamp || new Date().toISOString()
    };
    if (led !== undefined && led !== null) dev.led = led;
    if (status !== undefined && status !== null) dev.status = status;

    updateSingleSensorCardInPlace(dev);
    updateDashboardSummary(currentDevices);

    const modal = document.getElementById('sensorModal');
    if (modal && modal.classList.contains('active')) {
        const title = document.getElementById('modalSensorTitle')?.innerText || '';
        if (title.includes(numeroSerie)) {
            updateOpenModalValues(dev);
        }
    }

    if (document.body.classList.contains('fullscreen-active')) {
        const activeDev = currentDevices[fullscreenActiveIndex];
        if (activeDev && activeDev.numero_serie === numeroSerie) {
            renderFullscreenDevice(fullscreenActiveIndex);
        }
    }
}

function updateSingleSensorCardInPlace(dev) {
    if (!dev || !dev.numero_serie) return;
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
        badgeEl.className = `header-status-badge ${statusClass}`;
        badgeEl.innerHTML = `<span class="status-dot ${dotClass}" title="LED: ${translateLed(led)}"></span><span>${translateStatus(statusRaw)}</span>`;
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

function updateDashboardSummary(devices) {
    const cardStatusGeral = document.getElementById('cardStatusGeral');
    const cardStatusGeralSub = document.getElementById('cardStatusGeralSub');
    const cardCountAtencao = document.getElementById('cardCountAtencao');

    let countAtencao = 0;
    let countCritico = 0;

    devices.forEach(d => {
        const led = d.led || 'Verde';
        const st = d.status || 'Operacional';
        if (led === 'Vermelho' || led === 'Red' || st === 'Crítico' || st === 'Critical') {
            countCritico++;
        } else if (led === 'Amarelo' || led === 'Yellow' || st === 'Atenção' || st === 'Warning') {
            countAtencao++;
        }
    });

    if (cardCountAtencao) cardCountAtencao.innerText = countAtencao;

    if (cardStatusGeral) {
        if (countCritico > 0) {
            cardStatusGeral.innerText = 'Crítico';
            cardStatusGeral.style.color = '#dc2626';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = `${countCritico} dispositivo(s) em estado crítico`;
        } else if (countAtencao > 0) {
            cardStatusGeral.innerText = 'Atenção';
            cardStatusGeral.style.color = '#f59e0b';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = `${countAtencao} dispositivo(s) em desvio`;
        } else {
            cardStatusGeral.innerText = 'Excelente / Boa';
            cardStatusGeral.style.color = '#10b981';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = 'Parâmetros dentro da faixa ideal';
        }
    }
}

// ============================================================================
// CARROSSEL E CARDS FORA DA TELA CHEIA
// ============================================================================
const activeManometros = {};

function getTemperatureGaugeColor(tempVal) {
    if (tempVal === null || tempVal === undefined || isNaN(tempVal)) return '#94a3b8';
    const cfg = currentLimites.temperatura || { min_ideal: 18, max_ideal: 26, crit_min: 15, crit_max: 30 };
    const minI = (cfg.min_ideal !== null && cfg.min_ideal !== undefined) ? Number(cfg.min_ideal) : 18;
    const maxI = (cfg.max_ideal !== null && cfg.max_ideal !== undefined) ? Number(cfg.max_ideal) : 26;
    const critMin = (cfg.crit_min !== null && cfg.crit_min !== undefined) ? Number(cfg.crit_min) : 15;
    const critMax = (cfg.crit_max !== null && cfg.crit_max !== undefined) ? Number(cfg.crit_max) : 30;

    if (tempVal >= minI && tempVal <= maxI) return '#10b981';
    if ((tempVal >= critMin && tempVal < minI) || (tempVal > maxI && tempVal <= critMax)) return '#f59e0b';
    return '#ef4444';
}

function getHumidityGaugeColor(umidVal) {
    if (umidVal === null || umidVal === undefined || isNaN(umidVal)) return '#94a3b8';
    const cfg = currentLimites.umidade || { min_ideal: 30, max_ideal: 60, crit_min: 20, crit_max: 75 };
    const minI = (cfg.min_ideal !== null && cfg.min_ideal !== undefined) ? Number(cfg.min_ideal) : 30;
    const maxI = (cfg.max_ideal !== null && cfg.max_ideal !== undefined) ? Number(cfg.max_ideal) : 60;
    const critMin = (cfg.crit_min !== null && cfg.crit_min !== undefined) ? Number(cfg.crit_min) : 20;
    const critMax = (cfg.crit_max !== null && cfg.crit_max !== undefined) ? Number(cfg.crit_max) : 75;

    if (umidVal >= minI && umidVal <= maxI) return '#0284c7';
    if ((umidVal >= critMin && umidVal < minI) || (umidVal > maxI && umidVal <= critMax)) return '#f59e0b';
    return '#ef4444';
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
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: #888; width: 100%;">Nenhum transmissor LFG60 vinculado ao coworking.</div>`;
        return;
    }

    const existingCards = container.querySelectorAll('.sensor-card');
    const hasMatchingDom = existingCards.length === devices.length && devices.every(d => document.getElementById(`sensor-card-${d.numero_serie}`));

    if (hasMatchingDom) {
        devices.forEach(dev => updateSingleSensorCardInPlace(dev));
        const countPill = document.getElementById('devicesCountPill');
        if (countPill) countPill.innerText = `${devices.length} dispositivo${devices.length !== 1 ? 's' : ''}`;
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
            <div class="sensor-card ${isAlert ? 'alert' : ''}" id="sensor-card-${dev.numero_serie}" onclick="openDeviceDetailModal('${dev.numero_serie}')">
                <div class="sensor-header">
                    <h4>Espaço Coworking (3º Andar)</h4>
                    <div class="header-status-badge ${statusClass}" id="status-badge-${dev.numero_serie}">
                        <span class="status-dot ${dotClass}" title="LED: ${translateLed(led)}"></span>
                        <span>${translatedSt}</span>
                    </div>
                </div>

                <div class="sensor-gauges-row">
                    <!-- Temperatura -->
                    <div class="manometro-box">
                        <div class="manometro-canvas-wrapper">
                            <canvas id="gauge-temp-${dev.numero_serie}"></canvas>
                            <div class="manometro-center-info">
                                <span class="manometro-val" id="temp-val-${dev.numero_serie}" style="color: ${tempColor};">${tempDisplay}</span>
                                <span class="manometro-label">Temperatura</span>
                            </div>
                        </div>
                        <div class="manometro-scale">
                            <span>0°C</span>
                            <span>50°C</span>
                        </div>
                        <div class="manometro-ideal-badge">Ideal: ${(currentLimites.temperatura?.min_ideal ?? 18)}°C a ${(currentLimites.temperatura?.max_ideal ?? 26)}°C</div>
                    </div>

                    <!-- Umidade -->
                    <div class="manometro-box">
                        <div class="manometro-canvas-wrapper">
                            <canvas id="gauge-umid-${dev.numero_serie}"></canvas>
                            <div class="manometro-center-info">
                                <span class="manometro-val" id="umid-val-${dev.numero_serie}" style="color: ${umidColor};">${umidDisplay}</span>
                                <span class="manometro-label">Umidade</span>
                            </div>
                        </div>
                        <div class="manometro-scale">
                            <span>0%</span>
                            <span>100%</span>
                        </div>
                        <div class="manometro-ideal-badge">Ideal: ${(currentLimites.umidade?.min_ideal ?? 30)}% a ${(currentLimites.umidade?.max_ideal ?? 60)}%</div>
                    </div>
                </div>

                <div class="sensor-card-footer">
                    <div class="sensor-extra-pill">
                        <span>CO₂:</span>
                        <strong id="co2-val-${dev.numero_serie}">${co2Text}</strong>
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

    updateCarouselState();
}

function updateLfgDeviceSelect(devices) {
    const select = document.getElementById('lfgDeviceSelect');
    if (!select) return;

    const currentVal = select.value || 'all';
    let optionsHtml = '<option value="all">Todos os Dispositivos</option>';
    devices.forEach(d => {
        optionsHtml += `<option value="${d.numero_serie}">Transmissor ${d.numero_serie}</option>`;
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
            dot.title = `Ir para dispositivo ${idx + 1}`;
            dot.onclick = () => scrollCarouselToIndex(idx);
            indicatorsContainer.appendChild(dot);
        });
    } else if (indicatorsContainer && (!hasOverflow || cards.length <= 1)) {
        indicatorsContainer.innerHTML = '';
    }
}

// ============================================================================
// 6. APRESENTAÇÃO DE TELA CHEIA CORPORATIVA (CLIENTE COWORKING)
// ============================================================================
let fullscreenActiveIndex = 0;
let fsAutoplayInterval = null;
const fsAutoplayDuration = 8000;
let fsGaugeTempChart = null;
let fsGaugeUmidChart = null;
let fsKeyboardListenerAttached = false;

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
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const textEl = document.getElementById('fullscreenText');
    const iconEl = document.getElementById('fullscreenIcon');
    document.body.classList.toggle('fullscreen-active', isFull);
    
    if (textEl) {
        textEl.innerText = isFull ? 'Sair da Tela Cheia' : 'Tela Cheia Coworking';
    }
    if (iconEl) {
        if (isFull) {
            iconEl.innerHTML = '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>';
        } else {
            iconEl.innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>';
        }
    }

    if (isFull) {
        setupFullscreenPresentation();
    } else {
        stopFullscreenAutoplay();
        setTimeout(updateCarouselState, 250);
    }
}

function setupFullscreenPresentation() {
    if (!fsKeyboardListenerAttached) {
        document.addEventListener('keydown', handleFullscreenKeydown);
        fsKeyboardListenerAttached = true;
    }

    populateFsDeviceSelect();

    const standardSelect = document.getElementById('lfgDeviceSelect');
    if (standardSelect && standardSelect.value !== 'all' && currentDevices && currentDevices.length > 0) {
        const foundIdx = currentDevices.findIndex(d => d.numero_serie === standardSelect.value);
        if (foundIdx >= 0) fullscreenActiveIndex = foundIdx;
    }

    renderFullscreenDevice(fullscreenActiveIndex);
}

function populateFsDeviceSelect() {
    const select = document.getElementById('fsDeviceSelect');
    if (!select) return;

    if (!currentDevices || currentDevices.length === 0) {
        select.innerHTML = '<option value="">Espaço Coworking (Sem dados)</option>';
        return;
    }

    select.innerHTML = currentDevices.map((d, idx) => `
        <option value="${d.numero_serie}">Espaço Coworking (${idx + 1}/${currentDevices.length})</option>
    `).join('');
}

function onFsDeviceSelectChange(selectedSerial) {
    if (!selectedSerial || !currentDevices) return;
    const idx = currentDevices.findIndex(d => d.numero_serie === selectedSerial);
    if (idx >= 0) {
        renderFullscreenDevice(idx);
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

function updateFullscreenGaugeChart(chartInstance, canvasId, value, min, max, fillColor) {
    const val = (value !== null && value !== undefined && !isNaN(value)) ? Number(value) : min;
    const clamped = Math.max(min, Math.min(max, val));
    const progress = clamped - min;
    const remaining = max - clamped;

    if (chartInstance) {
        chartInstance.data.datasets[0].data = [progress, remaining];
        chartInstance.data.datasets[0].backgroundColor = [fillColor, '#e2e8f0'];
        chartInstance.update('none');
        return chartInstance;
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return null;

    const ctx = canvas.getContext('2d');
    return new Chart(ctx, {
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
            animation: { duration: 150 },
            plugins: {
                tooltip: { enabled: false },
                legend: { display: false }
            }
        }
    });
}

function renderFullscreenEmptyState() {
    fullscreenActiveIndex = 0;

    const titleEl = document.getElementById('fsDeviceTitle');
    if (titleEl) titleEl.innerText = 'Transmissor --';

    const statusPill = document.getElementById('fsStatusPill');
    const statusText = document.getElementById('fsStatusText');
    if (statusPill && statusText) {
        statusPill.className = 'cw-status-pill operacional';
        statusText.innerText = 'Aguardando Dados';
    }

    const lastTimeEl = document.getElementById('fsLastReadingTime');
    if (lastTimeEl) lastTimeEl.innerText = 'Nenhum transmissor LFG60 vinculado';

    const aqVal = document.getElementById('cwAirQualityValue');
    const aqBadge = document.getElementById('cwAirQualityBadge');
    if (aqVal) aqVal.innerText = 'Boa';
    if (aqBadge) aqBadge.className = 'cw-air-badge ideal';

    const tempValEl = document.getElementById('fsTempVal');
    if (tempValEl) tempValEl.innerText = '--';
    const umidValEl = document.getElementById('fsUmidVal');
    if (umidValEl) umidValEl.innerText = '--';

    fsGaugeTempChart = updateFullscreenGaugeChart(fsGaugeTempChart, 'fsGaugeTempCanvas', 0, 0, 50, '#e2e8f0');
    fsGaugeUmidChart = updateFullscreenGaugeChart(fsGaugeUmidChart, 'fsGaugeUmidCanvas', 0, 0, 100, '#e2e8f0');

    ['co2', 'pm25', 'pm10', 'voc', 'formaldeido'].forEach(p => {
        updateFsVarCard(p, null, () => '--', p);
    });

    const tCfg = currentLimites.temperatura || { min_ideal: 18, max_ideal: 26 };
    const uCfg = currentLimites.umidade || { min_ideal: 30, max_ideal: 60 };
    const fsGaugeMids = document.querySelectorAll('.fs-gauge-scale-mid');
    if (fsGaugeMids[0]) fsGaugeMids[0].innerText = `Faixa Ideal: ${(tCfg.min_ideal ?? 18)}° a ${(tCfg.max_ideal ?? 26)}°C`;
    if (fsGaugeMids[1]) fsGaugeMids[1].innerText = `Faixa Ideal: ${(uCfg.min_ideal ?? 30)}% a ${(uCfg.max_ideal ?? 60)}%`;

    renderFsDots();
    const counterEl = document.getElementById('fsDeviceCounterText');
    if (counterEl) counterEl.innerText = 'Aguardando vinculação';
}

function renderFullscreenDevice(index) {
    if (!currentDevices || currentDevices.length === 0) {
        renderFullscreenEmptyState();
        return;
    }

    if (index < 0) index = currentDevices.length - 1;
    if (index >= currentDevices.length) index = 0;
    fullscreenActiveIndex = index;

    const dev = currentDevices[index];
    const l = dev.ultima_leitura || {};

    // 1. Identificação do Dispositivo e Status Geral
    const titleEl = document.getElementById('fsDeviceTitle');
    if (titleEl) titleEl.innerText = `Transmissor LFG60 (${dev.numero_serie})`;

    const statusPill = document.getElementById('fsStatusPill');
    const statusText = document.getElementById('fsStatusText');
    const stRaw = dev.status || 'Operacional';
    if (statusPill && statusText) {
        const isCrit = stRaw === 'Crítico' || stRaw === 'Critical';
        const isWarn = stRaw === 'Atenção' || stRaw === 'Warning';
        const statusClass = isCrit ? 'critico' : (isWarn ? 'atencao' : 'operacional');
        statusPill.className = `cw-status-pill ${statusClass}`;
        statusText.innerText = translateStatus(stRaw);
    }

    const ledDot = document.getElementById('fsLedDot');
    const diagLed = document.getElementById('fsDiagLedVal');
    const led = dev.led || 'Verde';
    if (ledDot) {
        const isRed = led === 'Vermelho' || led === 'Red';
        const isYellow = led === 'Amarelo' || led === 'Yellow';
        ledDot.style.background = isRed ? '#ef4444' : (isYellow ? '#f59e0b' : '#10b981');
    }
    if (diagLed) {
        diagLed.innerText = translateLed(led);
        diagLed.style.color = (led === 'Vermelho' || led === 'Red') ? '#ef4444' : ((led === 'Amarelo' || led === 'Yellow') ? '#f59e0b' : '#10b981');
    }

    const lastTimeEl = document.getElementById('fsLastReadingTime');
    if (lastTimeEl) {
        const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleTimeString('pt-BR') : '--';
        lastTimeEl.innerText = `Última leitura: ${timeStr}`;
    }

    // 2. Valores Numéricos de Temperatura e Umidade
    const tempVal = (l.temperatura !== null && l.temperatura !== undefined) ? Number(l.temperatura) : null;
    const umidVal = (l.umidade !== null && l.umidade !== undefined) ? Number(l.umidade) : null;

    const tempDisplay = tempVal !== null ? `${tempVal.toFixed(1)}` : '--';
    const umidDisplay = umidVal !== null ? `${umidVal.toFixed(1)}` : '--';

    const tempColor = getTemperatureGaugeColor(tempVal);
    const umidColor = getHumidityGaugeColor(umidVal);

    const tempEval = getParamEvaluation('temperatura', tempVal);
    const umidEval = getParamEvaluation('umidade', umidVal);

    // 3. Atualização do Card de Qualidade do Ar (Lado Esquerdo da Seção Hero de 45%)
    const aqVal = document.getElementById('cwAirQualityValue');
    const aqBadge = document.getElementById('cwAirQualityBadge');
    const aqDesc = document.getElementById('cwAirQualityDesc');
    const heroTemp = document.getElementById('cwHeroTempVal');
    const heroUmid = document.getElementById('cwHeroUmidVal');
    const heroCo2 = document.getElementById('cwHeroCo2Val');

    if (heroTemp) heroTemp.innerText = tempVal !== null ? `${tempVal.toFixed(1)}°C` : '--';
    if (heroUmid) heroUmid.innerText = umidVal !== null ? `${umidVal.toFixed(1)}%` : '--';
    if (heroCo2) heroCo2.innerText = l.co2 !== null && l.co2 !== undefined ? `${l.co2} ppm` : '--';

    // Determina a situação da Qualidade do Ar
    let outCount = 0;
    ['temperatura', 'umidade', 'co2', 'pm25', 'pm10', 'voc', 'formaldeido'].forEach(p => {
        const ev = getParamEvaluation(p, l[p]);
        if (ev.cls !== 'ideal') outCount++;
    });

    if (aqVal && aqBadge && aqDesc) {
        if (outCount === 0) {
            aqVal.innerText = 'Boa'; // Conforme solicitado no requisito
            aqBadge.className = 'cw-air-badge ideal';
            aqDesc.innerText = 'Ambiente salubre e climatizado. Índices dentro das normas sanitárias e de bem-estar para garantir foco, conforto térmico e produtividade das equipes.';
        } else if (outCount <= 2) {
            aqVal.innerText = 'Boa (Leve Variação)';
            aqBadge.className = 'cw-air-badge atencao';
            aqDesc.innerText = 'Ambiente monitorado em tempo real. Parâmetros sob controle preventivo, mantendo a salubridade e ventilação contínua.';
        } else {
            aqVal.innerText = 'Atenção Necessária';
            aqBadge.className = 'cw-air-badge critico';
            aqDesc.innerText = 'Oscilação em parâmetros ambientais detectada. Recomenda-se aumentar a ventilação e ajustar a climatização.';
        }
    }

    // Destaques de Bem-Estar (Lado Direito da Seção Hero)
    const wellnessTemp = document.getElementById('cwWellnessTemp');
    const wellnessRenov = document.getElementById('cwWellnessRenov');
    const wellnessPureza = document.getElementById('cwWellnessPureza');

    if (wellnessTemp) {
        if (tempVal !== null) {
            wellnessTemp.innerText = `${tempDisplay}°C (${tempEval.text})`;
        } else {
            wellnessTemp.innerText = 'Climatização Estável';
        }
    }

    if (wellnessRenov) {
        if (l.co2 !== null && l.co2 !== undefined) {
            const co2Num = Number(l.co2);
            wellnessRenov.innerText = co2Num <= 800 ? 'Ar Puro & Renovado' : 'Ventilação Recomendada';
        } else {
            wellnessRenov.innerText = 'Oxigenação Conforme';
        }
    }

    if (wellnessPureza) {
        const pm25Num = l.pm25 !== null && l.pm25 !== undefined ? Number(l.pm25) : 0;
        wellnessPureza.innerText = pm25Num <= 15 ? 'Filtros em Dia (Puro)' : 'Filtragem Ativa';
    }

    // 4. Manômetros de Temperatura e Umidade (Área Inferior Branca)
    const tempValEl = document.getElementById('fsTempVal');
    if (tempValEl) {
        tempValEl.innerText = tempDisplay;
        tempValEl.style.color = tempColor;
    }
    const tempChipEl = document.getElementById('fsTempChip');
    if (tempChipEl) {
        tempChipEl.className = `cw-status-chip ${tempEval.cls}`;
        tempChipEl.innerText = tempEval.text;
    }

    const umidValEl = document.getElementById('fsUmidVal');
    if (umidValEl) {
        umidValEl.innerText = umidDisplay;
        umidValEl.style.color = umidColor;
    }
    const umidChipEl = document.getElementById('fsUmidChip');
    if (umidChipEl) {
        umidChipEl.className = `cw-status-chip ${umidEval.cls}`;
        umidChipEl.innerText = umidEval.text;
    }

    fsGaugeTempChart = updateFullscreenGaugeChart(fsGaugeTempChart, 'fsGaugeTempCanvas', tempVal, 0, 50, tempColor);
    fsGaugeUmidChart = updateFullscreenGaugeChart(fsGaugeUmidChart, 'fsGaugeUmidCanvas', umidVal, 0, 100, umidColor);

    // 4.1 Atualiza legendas dinâmicas de faixa ideal a partir dos limites configurados no banco
    const tCfg = currentLimites.temperatura || { min_ideal: 18, max_ideal: 26 };
    const uCfg = currentLimites.umidade || { min_ideal: 30, max_ideal: 60 };
    const fsGaugeMids = document.querySelectorAll('.fs-gauge-scale-mid');
    if (fsGaugeMids[0]) fsGaugeMids[0].innerText = `Faixa Ideal: ${(tCfg.min_ideal ?? 18)}° a ${(tCfg.max_ideal ?? 26)}°C`;
    if (fsGaugeMids[1]) fsGaugeMids[1].innerText = `Faixa Ideal: ${(uCfg.min_ideal ?? 30)}% a ${(uCfg.max_ideal ?? 60)}%`;

    // 5. Demais Parâmetros Ambientais (Grid)
    updateFsVarCard('co2', l.co2, val => val !== null && val !== undefined ? String(val) : '--', 'co2');
    updateFsVarCard('pm25', l.pm25, val => val !== null && val !== undefined ? Number(val).toFixed(1) : '--', 'pm25');
    updateFsVarCard('pm10', l.pm10, val => val !== null && val !== undefined ? Number(val).toFixed(1) : '--', 'pm10');
    updateFsVarCard('voc', l.voc, val => val !== null && val !== undefined ? Number(val).toFixed(2) : '--', 'voc');
    updateFsVarCard('formaldeido', l.formaldeido, val => val !== null && val !== undefined ? Number(val).toFixed(3) : '--', 'formaldeido');

    // 6. Diagnóstico do Espaço
    const diagBadge = document.getElementById('fsStatus-diag');
    const diagEval = document.getElementById('fsDiagEvaluation');
    if (diagBadge && diagEval) {
        if (outCount === 0) {
            diagBadge.className = 'cw-box-status ideal';
            diagBadge.innerText = '100% Conforme';
            diagEval.innerText = 'Todos os 7 parâmetros em conformidade';
            diagEval.style.color = '#059669';
        } else {
            diagBadge.className = 'cw-box-status aviso';
            diagBadge.innerText = 'Variação';
            diagEval.innerText = `${outCount} parâmetro(s) em monitoramento preventivo`;
            diagEval.style.color = '#d97706';
        }
    }

    // 7. Atualiza Navegação (Dots e Contador)
    renderFsDots();
    const counterEl = document.getElementById('fsDeviceCounterText');
    if (counterEl) {
        counterEl.innerText = `Dispositivo ${fullscreenActiveIndex + 1} de ${currentDevices.length}`;
    }

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
        statusEl.className = `cw-box-status ${evaluation.cls}`;
        statusEl.innerText = evaluation.text === 'Ideal' ? 'Excelente' : (evaluation.text === 'Normal' ? 'Seguro' : evaluation.text);
    }
    if (cardEl) {
        if (evaluation.cls === 'critico') {
            cardEl.style.borderColor = '#fecaca';
            cardEl.style.backgroundColor = '#fff5f5';
        } else if (evaluation.cls === 'aviso') {
            cardEl.style.borderColor = '#fde68a';
            cardEl.style.backgroundColor = '#fffdf0';
        } else {
            cardEl.style.borderColor = '#e2e8f0';
            cardEl.style.backgroundColor = '#f8fafc';
        }

        const hintSpan = cardEl.querySelector('.cw-box-hint');
        if (hintSpan && currentLimites[evalKey] && currentLimites[evalKey].max_ideal !== undefined && currentLimites[evalKey].max_ideal !== null) {
            hintSpan.innerHTML = `Limite Ideal: &le; ${currentLimites[evalKey].max_ideal} ${currentLimites[evalKey].unit || ''}`;
        }
    }
}

function renderFsDots() {
    const dotsContainer = document.getElementById('fsCarouselDots');
    if (!dotsContainer || !currentDevices) return;

    dotsContainer.innerHTML = currentDevices.map((_, idx) => `
        <div class="fs-dot ${idx === fullscreenActiveIndex ? 'active' : ''}" 
             onclick="renderFullscreenDevice(${idx})" 
             title="Ir para transmissor ${idx + 1}"></div>
    `).join('');
}

function navigateFullscreenCarousel(direction) {
    renderFullscreenDevice(fullscreenActiveIndex + direction);

    if (fsAutoplayInterval) {
        clearInterval(fsAutoplayInterval);
        fsAutoplayInterval = setInterval(() => {
            navigateFullscreenCarousel(1);
        }, fsAutoplayDuration);
    }
}

function toggleFullscreenAutoplay() {
    if (fsAutoplayInterval) {
        stopFullscreenAutoplay();
    } else {
        startFullscreenAutoplay();
    }
}

function startFullscreenAutoplay() {
    if (fsAutoplayInterval) clearInterval(fsAutoplayInterval);
    fsAutoplayInterval = setInterval(() => {
        navigateFullscreenCarousel(1);
    }, fsAutoplayDuration);

    const btn = document.getElementById('fsAutoplayBtn');
    const text = document.getElementById('fsAutoplayText');
    const icon = document.getElementById('fsAutoplayIcon');
    if (btn) btn.classList.add('active');
    if (text) text.innerText = 'Pausar (8s)';
    if (icon) {
        icon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
    }
}

function stopFullscreenAutoplay() {
    if (fsAutoplayInterval) {
        clearInterval(fsAutoplayInterval);
        fsAutoplayInterval = null;
    }
    const btn = document.getElementById('fsAutoplayBtn');
    const text = document.getElementById('fsAutoplayText');
    const icon = document.getElementById('fsAutoplayIcon');
    if (btn) btn.classList.remove('active');
    if (text) text.innerText = 'Auto (8s)';
    if (icon) {
        icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
    }
}

function updateFullscreenTelemetry() {
    if (!currentDevices || currentDevices.length === 0) {
        renderFullscreenEmptyState();
        return;
    }
    populateFsDeviceSelect();
    renderFullscreenDevice(fullscreenActiveIndex);
}

// ============================================================================
// MODAL DE DETALHES DO DISPOSITIVO
// ============================================================================
function openDeviceDetailModal(numeroSerie) {
    const dev = currentDevices.find(d => d.numero_serie === numeroSerie);
    if (!dev) return;

    const modal = document.getElementById('sensorModal');
    const title = document.getElementById('modalSensorTitle');
    const locText = document.getElementById('modalLocationText');
    const lastTime = document.getElementById('modalLastTimestamp');

    if (title) title.innerText = `Detalhes: Espaço Coworking (${dev.numero_serie})`;
    if (locText) locText.innerText = `Número de Série: ${dev.numero_serie} | Local: 3º Andar`;
    if (lastTime) {
        const timeStr = dev.ultima_leitura?.timestamp ? new Date(dev.ultima_leitura.timestamp).toLocaleString('pt-BR') : '--';
        lastTime.innerText = `Última Leitura: ${timeStr}`;
    }

    updateOpenModalValues(dev);
    fetchDeviceHistory(numeroSerie);

    if (modal) modal.classList.add('active');
}

function updateOpenModalValues(dev) {
    const l = dev.ultima_leitura || {};
    const led = dev.led || 'Verde';
    const dot = document.getElementById('modalLedDot');
    const ledText = document.getElementById('modalLedText');
    const devStatus = document.getElementById('modalDeviceStatus');

    if (dot) {
        const isRed = led === 'Vermelho' || led === 'Red';
        const isYellow = led === 'Amarelo' || led === 'Yellow';
        dot.style.background = isRed ? '#dc2626' : (isYellow ? '#f59e0b' : '#10b981');
    }
    if (ledText) ledText.innerText = `LED: ${translateLed(led)}`;
    if (devStatus) devStatus.innerText = `Status Geral: ${translateStatus(dev.status)}`;

    const grid = document.getElementById('modalParamsGrid');
    if (grid) {
        grid.innerHTML = `
            ${renderModalParamCard('Temperatura Ambiente', l.temperatura, '°C', '18.0 - 26.0 °C', l.temperatura < 18 || l.temperatura > 26)}
            ${renderModalParamCard('Umidade Relativa', l.umidade, '%', '30.0 - 60.0 %', l.umidade < 30 || l.umidade > 60)}
            ${renderModalParamCard('CO₂', l.co2, 'ppm', '≤ 800 ppm', l.co2 > 800)}
            ${renderModalParamCard('PM2.5', l.pm25, 'µg/m³', '≤ 15 µg/m³', l.pm25 > 15)}
            ${renderModalParamCard('PM10', l.pm10, 'µg/m³', '≤ 30 µg/m³', l.pm10 > 30)}
            ${renderModalParamCard('VOC', l.voc, 'ppm', '≤ 0.20 ppm', l.voc > 0.20)}
            ${renderModalParamCard('Formaldeído', l.formaldeido, 'mg/m³', '≤ 0.05 mg/m³', l.formaldeido > 0.05)}
        `;
    }
}

function renderModalParamCard(name, val, unit, idealRange, isAlert) {
    const displayVal = val !== null && val !== undefined ? val : '--';
    return `
        <div class="param-detail-card ${isAlert ? 'alert' : ''}" style="background: #1e293b; padding: 12px; border-radius: 8px; border: 1px solid ${isAlert ? '#ef4444' : '#334155'};">
            <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">${name}</div>
            <div style="font-size: 20px; font-weight: 800; color: ${isAlert ? '#ef4444' : '#f8fafc'}; margin: 4px 0;">${displayVal} <span style="font-size: 12px; font-weight: 500; color: #94a3b8;">${unit}</span></div>
            <div style="font-size: 10px; color: #64748b;">Faixa Ideal: ${idealRange}</div>
        </div>
    `;
}

async function fetchDeviceHistory(numeroSerie) {
    const historyContainer = document.getElementById('modalHistoryContainer');
    if (!historyContainer) return;

    try {
        const res = await fetch(`${API_BASE}/api/lfg60/${numeroSerie}/leituras`, {
            headers: getAuthHeaders()
        });
        if (res.ok) {
            const result = await res.json();
            const leituras = result.data || result || [];
            if (Array.isArray(leituras) && leituras.length > 0) {
                historyContainer.innerHTML = leituras.slice(0, 10).map(item => {
                    const time = new Date(item.timestamp || item.data_hora).toLocaleTimeString('pt-BR');
                    return `
                        <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #1e293b;">
                            <span>${time}</span>
                            <span>Temp: <strong>${item.temperatura ?? '--'}°C</strong> | Umid: <strong>${item.umidade ?? '--'}%</strong> | CO₂: <strong>${item.co2 ?? '--'} ppm</strong></span>
                        </div>
                    `;
                }).join('');
            } else {
                historyContainer.innerHTML = '<div>Nenhum histórico registrado recentemente.</div>';
            }
        } else {
            historyContainer.innerHTML = '<div>Sem registros recentes de histórico.</div>';
        }
    } catch (e) {
        historyContainer.innerHTML = '<div>Histórico em atualização contínua.</div>';
    }
}

function closeSensorModal() {
    const modal = document.getElementById('sensorModal');
    if (modal) modal.classList.remove('active');
}

// ============================================================================
// MODAL DE LIMITES E FAIXAS PRESCRITAS
// ============================================================================
async function openPrescribedRangesModal() {
    const modal = document.getElementById('rangesModal');
    const tbody = document.getElementById('rangesTableBody');
    if (!modal || !tbody) return;

    try {
        const res = await fetch(`${API_BASE}/api/lfg60/limites`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('Erro ao buscar limites');
        const limites = await res.json();
        
        let html = '';
        const order = ['temperatura', 'umidade', 'co2', 'pm25', 'pm10', 'voc', 'formaldeido'];
        order.forEach(key => {
            const l = limites[key];
            if (!l) return;
            
            const hasMin = (key === 'temperatura' || key === 'umidade') || (l.min_ideal !== null && l.min_ideal !== undefined);
            const step = (key === 'voc' || key === 'formaldeido') ? '0.01' : '0.1';
            const inputStyle = 'width: 60px; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 4px; padding: 4px 2px; text-align: center; font-size: 12px; margin: 0 2px;';
            const translatedLabel = translateParamKey(key);

            const minIdealVal = (l.min_ideal !== null && l.min_ideal !== undefined) ? l.min_ideal : '';
            const maxIdealVal = (l.max_ideal !== null && l.max_ideal !== undefined) ? l.max_ideal : '';
            const maxAvisoVal = (l.max_aviso !== null && l.max_aviso !== undefined) ? l.max_aviso : '';
            const critMinVal = (l.crit_min !== null && l.crit_min !== undefined) ? l.crit_min : '';
            const critMaxVal = (l.crit_max !== null && l.crit_max !== undefined) ? l.crit_max : '';
            
            html += `
            <tr data-param="${key}">
                <td style="white-space: nowrap;"><strong>${translatedLabel}</strong></td>
                <td>${l.unit}</td>
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
                        `&gt; Máximo de Aviso`
                    }
                </td>
            </tr>
            `;
        });
        tbody.innerHTML = html;
        modal.classList.add('active');
    } catch (e) {
        console.error('Erro ao abrir modal de limites:', e);
        alert('Erro ao carregar limites do banco de dados.');
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
            Object.keys(novosLimites).forEach(param => {
                if (!currentLimites[param]) currentLimites[param] = {};
                Object.assign(currentLimites[param], novosLimites[param]);
            });

            alert('Limites e Faixas atualizados com sucesso!');
            closeRangesModal();
            await loadDashboardData();
        } else {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData.error || errData.erro || errData.message || `Erro ao salvar limites (${res.status})`;
            alert(`Erro ao salvar limites: ${errMsg}`);
        }
    } catch (e) {
        alert(`Erro de conexão com o servidor: ${e.message || e}`);
    }
}

// ============================================================================
// CENTRAL DE ALERTAS
// ============================================================================
async function fetchAlertsFromApi() {
    try {
        const res = await fetch(`${API_BASE}/api/lfg60/alertas`, {
            headers: getAuthHeaders()
        });
        if (res.ok) {
            const result = await res.json();
            currentAlerts = result.data || result || [];
            updateAlertsUI();
        }
    } catch (e) {
        console.warn('[Coworking] Erro ao buscar alertas:', e.message);
    }
}

function updateAlertsUI() {
    const badge = document.getElementById('headerAlertBadge');
    const cardCount = document.getElementById('cardCountAlertas');
    const cardAlertasSub = document.getElementById('cardAlertasSub');

    const unreadCount = currentAlerts.filter(a => !a.lido).length;

    if (badge) {
        badge.innerText = unreadCount;
        badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    }

    if (cardCount) cardCount.innerText = unreadCount;
    if (cardAlertasSub) {
        cardAlertasSub.innerText = unreadCount > 0 ? `${unreadCount} alerta(s) pendente(s)` : 'Nenhum alerta pendente';
    }

    renderAlertsList();
}

function toggleHeaderAlerts() {
    const popover = document.getElementById('headerAlertsPopover');
    if (popover) popover.classList.toggle('active');
}

function filterAlerts(filterType, btnEl) {
    activeAlertFilter = filterType;
    const filterTabs = document.querySelectorAll('.popover-filters .filter-tab');
    filterTabs.forEach(tab => tab.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    renderAlertsList();
}

function renderAlertsList() {
    const listEl = document.getElementById('headerAlertsList');
    if (!listEl) return;

    let filtered = currentAlerts;
    if (activeAlertFilter !== 'todos') {
        filtered = currentAlerts.filter(a => {
            const t = (a.tipo || a.gravidade || '').toLowerCase();
            return t === activeAlertFilter.toLowerCase();
        });
    }

    if (filtered.length === 0) {
        listEl.innerHTML = '<div style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">Nenhum alerta para o filtro selecionado.</div>';
        return;
    }

    listEl.innerHTML = filtered.map(a => {
        const time = new Date(a.criado_em || a.timestamp || Date.now()).toLocaleTimeString('pt-BR');
        return `
            <div class="alert-item ${a.lido ? 'read' : 'unread'}" style="padding: 10px; border-bottom: 1px solid #1e293b; font-size: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                    <strong style="color: ${a.tipo === 'Critico' ? '#ef4444' : '#f59e0b'};">${a.tipo || 'Aviso'}</strong>
                    <span style="color: #64748b; font-size: 11px;">${time}</span>
                </div>
                <div style="color: #cbd5e1;">${a.mensagem || a.descricao || 'Desvio detectado'}</div>
            </div>
        `;
    }).join('');
}

async function markAllAlertsAsRead() {
    try {
        const res = await fetch(`${API_BASE}/api/lfg60/alertas/limpar-todos`, {
            method: 'PUT',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            currentAlerts.forEach(a => a.lido = true);
            updateAlertsUI();
        }
    } catch (e) {
        console.error('Erro ao marcar alertas como lidos:', e);
    }
}

// Fechamento de modais ao clicar no overlay
document.addEventListener('click', function(e) {
    const sensorModal = document.getElementById('sensorModal');
    const rangesModal = document.getElementById('rangesModal');
    if (sensorModal && e.target === sensorModal) closeSensorModal();
    if (rangesModal && e.target === rangesModal) closeRangesModal();
});
