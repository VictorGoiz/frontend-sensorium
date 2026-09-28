let mapInstance = null;
let currentDevices = [];
let currentAlerts = [];
let activeAlertFilter = 'todos';
let sensorBadgeWatchdog = null;
let simulationStepCount = 0;

// ----------------------------------------------------
// DISPOSITIVOS SIMULADOS DE EXEMPLO (DEMONSTRAÇÃO FRONTEND)
// ----------------------------------------------------
const SIMULATED_LFG60_DEVICES = [
    {
        numero_serie: 'LFG60-SIM-01',
        nome: 'Meeting Room - Floor 2',
        cliente: 'LEFOO Innovation Lab',
        status: 'Operational',
        led: 'Green',
        isSimulated: true,
        ultima_leitura: {
            temperatura: 22.4,
            umidade: 48.5,
            co2: 520,
            pm25: 8.2,
            pm10: 16.5,
            voc: 0.08,
            formaldeido: 0.015,
            timestamp: new Date().toISOString()
        }
    },
    {
        numero_serie: 'LFG60-SIM-02',
        nome: 'Cleanroom Lab - Zone B',
        cliente: 'LEFOO Innovation Lab',
        status: 'Operational',
        led: 'Green',
        isSimulated: true,
        ultima_leitura: {
            temperatura: 23.8,
            umidade: 52.0,
            co2: 640,
            pm25: 10.4,
            pm10: 21.2,
            voc: 0.11,
            formaldeido: 0.022,
            timestamp: new Date().toISOString()
        }
    }
];

/**
 * Translations helpers
 */
function translateLed(led) {
    if (!led) return 'Green';
    const l = String(led).toLowerCase();
    if (l === 'vermelho' || l === 'red') return 'Red';
    if (l === 'amarelo' || l === 'yellow') return 'Yellow';
    if (l === 'verde' || l === 'green') return 'Green';
    return led;
}

function translateStatus(st) {
    if (!st) return 'Operational';
    const s = String(st).toLowerCase();
    if (s === 'operacional' || s === 'operational') return 'Operational';
    if (s === 'atenção' || s === 'atencao' || s === 'warning') return 'Warning';
    if (s === 'crítico' || s === 'critico' || s === 'critical') return 'Critical';
    if (s === 'normal') return 'Normal';
    return st;
}

function translateParamKey(param) {
    const map = {
        'temperatura': 'Temperature',
        'umidade': 'Relative Humidity',
        'co2': 'Carbon Dioxide (CO₂)',
        'pm25': 'Fine Particulate Matter (PM2.5)',
        'pm10': 'Inhalable Particles (PM10)',
        'voc': 'Volatile Organic Compounds (VOC)',
        'formaldeido': 'Formaldehyde (HCHO)'
    };
    return map[param] || param;
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
        if (badgeText) badgeText.innerText = 'LIVE';
        if (sensorBadgeWatchdog) clearTimeout(sensorBadgeWatchdog);
        sensorBadgeWatchdog = setTimeout(() => {
            setSensorLiveBadgeState(false);
        }, 15000);
    } else {
        badge.classList.remove('active');
        if (badgeText) badgeText.innerText = 'WAITING FOR DATA';
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

    // Variação dos dispositivos simulados a cada 3 segundos
    setInterval(simulateLiveLfg60Step, 3000);

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
        const socket = io(API_BASE, { auth: { token: localStorage.getItem('sensorium_token') } });
        socket.on('dashboard_update', (data) => {
            console.log('[LFG60] WebSocket update received:', data);
            triggerDashboardUpdate(data);
        });

        socket.on('disconnect', () => {
            setSensorLiveBadgeState(false);
        });
    } else {
        console.warn('[LFG60] Socket.IO not loaded. Falling back to polling.');
        setInterval(loadDashboardData, 10000);
    }

    // Fullscreen change listener
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

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

async function loadDashboardData() {
    await Promise.all([
        fetchDevicesFromApi(),
        fetchAlertsFromApi()
    ]);
}

function getAuthHeaders() {
    const token = localStorage.getItem('sensorium_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

// ----------------------------------------------------
// 1. DEVICES AND READINGS FROM API / SIMULATION
// ----------------------------------------------------
async function fetchDevicesFromApi() {
    try {
        let loadedData = null;
        try {
            const res = await fetch(`${API_BASE}/api/lfg60`, {
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const result = await res.json();
                if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                    loadedData = result.data;
                }
            }
        } catch (apiErr) {}

        if (!loadedData || loadedData.length === 0) {
            if (currentDevices.length === 0) {
                currentDevices = JSON.parse(JSON.stringify(SIMULATED_LFG60_DEVICES));
            }
        } else {
            SIMULATED_LFG60_DEVICES.forEach(sim => {
                if (!loadedData.some(d => d.numero_serie === sim.numero_serie)) {
                    loadedData.push(JSON.parse(JSON.stringify(sim)));
                }
            });
            currentDevices = loadedData;
        }

        updateLfgDeviceSelect(currentDevices);
        renderSensorCards(currentDevices);
        updateDashboardSummary(currentDevices);
        if (document.body.classList.contains('fullscreen-active')) {
            updateFullscreenTelemetry();
        }

        const hasData = currentDevices.length > 0 && currentDevices.some(d => d.ultima_leitura && (d.ultima_leitura.temperatura !== null || d.ultima_leitura.umidade !== null || d.ultima_leitura.co2 !== null));
        if (hasData) {
            setSensorLiveBadgeState(true);
        } else if (currentDevices.length === 0) {
            setSensorLiveBadgeState(false);
        }
    } catch (err) {
        console.warn('[LFG60] Error loading sensors:', err.message);
        if (currentDevices.length === 0) {
            currentDevices = JSON.parse(JSON.stringify(SIMULATED_LFG60_DEVICES));
            updateLfgDeviceSelect(currentDevices);
            renderSensorCards(currentDevices);
            updateDashboardSummary(currentDevices);
            setSensorLiveBadgeState(true);
        }
    }
}

function getRandomInRange(min, max, decimals = 1) {
    const factor = Math.pow(10, decimals);
    return Math.round((min + Math.random() * (max - min)) * factor) / factor;
}

/**
 * Simulação dos valores de telemetria dos dispositivos de exemplo a cada 3 segundos
 */
function simulateLiveLfg60Step() {
    if (!currentDevices || currentDevices.length === 0) return;

    let hasSimulated = false;

    currentDevices.forEach((dev) => {
        // Apenas alterar dispositivos explicitamente simulados, nunca sobrescrever dispositivos reais de produção
        if (dev && (dev.isSimulated === true || (dev.numero_serie && dev.numero_serie.startsWith('LFG60-SIM')))) {
            hasSimulated = true;
            if (!dev.ultima_leitura) {
                dev.ultima_leitura = {};
            }

            const l = dev.ultima_leitura;

            // Temperatura aleatória de 18°C a 36°C a cada 3 segundos
            l.temperatura = getRandomInRange(18.0, 36.0, 1);
            l.umidade = getRandomInRange(35.0, 65.0, 1);
            l.co2 = getRandomInRange(450, 950, 0);
            l.pm25 = getRandomInRange(5.0, 20.0, 1);
            l.pm10 = getRandomInRange(10.0, 35.0, 1);
            l.voc = getRandomInRange(0.04, 0.18, 2);
            l.formaldeido = getRandomInRange(0.010, 0.035, 3);
            l.timestamp = new Date().toISOString();

            // Status e LED reativos
            const isCrit = l.temperatura < 15 || l.temperatura > 30 || l.umidade < 20 || l.umidade > 75 || l.co2 > 1200;
            const isWarn = l.temperatura < 18 || l.temperatura > 26 || l.umidade < 30 || l.umidade > 60 || l.co2 > 800;

            if (isCrit) {
                dev.led = 'Red';
                dev.status = 'Critical';
            } else if (isWarn) {
                dev.led = 'Yellow';
                dev.status = 'Warning';
            } else {
                dev.led = 'Green';
                dev.status = 'Operational';
            }
        }
    });

    if (hasSimulated) {
        setSensorLiveBadgeState(true);
        renderSensorCards(currentDevices);
        updateDashboardSummary(currentDevices);

        if (document.body.classList.contains('fullscreen-active')) {
            renderFullscreenDevice(fullscreenActiveIndex);
        }

        // Atualiza modal se estiver aberto no dispositivo simulado
        const modal = document.getElementById('sensorModal');
        if (modal && modal.classList.contains('active')) {
            const title = document.getElementById('modalSensorTitle')?.innerText || '';
            const openDev = currentDevices.find(d => title.includes(d.numero_serie));
            if (openDev && (openDev.isSimulated || (openDev.numero_serie && openDev.numero_serie.startsWith('LFG60-SIM')))) {
                updateOpenModalSimulatedValues(openDev);
            }
        }
    }
}

function updateOpenModalSimulatedValues(dev) {
    const l = dev.ultima_leitura || {};
    const timestampStr = l.timestamp ? new Date(l.timestamp).toLocaleString('en-US') : 'No reading records';
    const timeEl = document.getElementById('modalLastTimestamp');
    if (timeEl) timeEl.innerText = `Last Reading: ${timestampStr}`;

    const led = dev.led || 'Green';
    const dot = document.getElementById('modalLedDot');
    const ledText = document.getElementById('modalLedText');
    const devStatus = document.getElementById('modalDeviceStatus');

    if (dot) {
        const isRed = led === 'Vermelho' || led === 'Red';
        const isYellow = led === 'Amarelo' || led === 'Yellow';
        dot.style.background = isRed ? '#dc2626' : (isYellow ? '#f59e0b' : '#10b981');
    }
    if (ledText) ledText.innerText = `Indicator LED: ${translateLed(led)}`;
    if (devStatus) devStatus.innerText = `Overall Status: ${translateStatus(dev.status)}`;

    const grid = document.getElementById('modalParamsGrid');
    if (grid) {
        grid.innerHTML = `
            ${renderParamCard('Temperature', l.temperatura, '°C', '18.0 - 26.0 °C', l.temperatura < 18 || l.temperatura > 26)}
            ${renderParamCard('Relative Humidity', l.umidade, '%', '30.0 - 60.0 %', l.umidade < 30 || l.umidade > 60)}
            ${renderParamCard('CO2', l.co2, 'ppm', '≤ 800 ppm', l.co2 > 800)}
            ${renderParamCard('PM2.5', l.pm25, 'µg/m³', '≤ 15 µg/m³', l.pm25 > 15)}
            ${renderParamCard('PM10', l.pm10, 'µg/m³', '≤ 30 µg/m³', l.pm10 > 30)}
            ${renderParamCard('VOC', l.voc, 'ppm', '≤ 0.20 ppm', l.voc > 0.20)}
            ${renderParamCard('Formaldehyde', l.formaldeido, 'mg/m³', '≤ 0.05 mg/m³', l.formaldeido > 0.05)}
        `;
    }
}

function updateLfgDeviceSelect(devices) {
    const select = document.getElementById('lfgDeviceSelect');
    if (!select) return;

    const currentVal = select.value || 'all';
    let optionsHtml = '<option value="all">All Devices</option>';
    devices.forEach(d => {
        optionsHtml += `<option value="${d.numero_serie}">Transmitter ${d.numero_serie}</option>`;
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
    if (tempVal >= 18 && tempVal <= 26) return '#10b981'; // Ideal Green
    if ((tempVal >= 15 && tempVal < 18) || (tempVal > 26 && tempVal <= 30)) return '#f59e0b'; // Warning Yellow
    return '#ef4444'; // Critical Red
}

function getHumidityGaugeColor(umidVal) {
    if (umidVal === null || umidVal === undefined || isNaN(umidVal)) return '#94a3b8';
    if (umidVal >= 30 && umidVal <= 60) return '#0284c7'; // Ideal Ocean Blue
    if ((umidVal >= 20 && umidVal < 30) || (umidVal > 60 && umidVal <= 75)) return '#f59e0b'; // Warning Yellow
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
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: #888; width: 100%;">No devices registered in the database.</div>`;
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
            countPill.innerText = `${devices.length} device${devices.length !== 1 ? 's' : ''}`;
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
            <div class="sensor-card ${isAlert ? 'alert' : ''}" id="sensor-card-${dev.numero_serie}" onclick="openDeviceDetailModal('${dev.numero_serie}')">
                <div class="sensor-header">
                    <h4>Transmitter ${dev.numero_serie}</h4>
                    <div class="header-status-badge ${statusClass}" id="status-badge-${dev.numero_serie}">
                        <span class="status-dot ${dotClass}" title="LED: ${translateLed(led)}"></span>
                        <span>${translatedSt}</span>
                    </div>
                </div>

                <div class="sensor-gauges-row">
                    <!-- Temperature Gauge -->
                    <div class="manometro-box">
                        <div class="manometro-canvas-wrapper">
                            <canvas id="gauge-temp-${dev.numero_serie}"></canvas>
                            <div class="manometro-center-info">
                                <span class="manometro-val" id="temp-val-${dev.numero_serie}" style="color: ${tempColor};">${tempDisplay}</span>
                                <span class="manometro-label">Temperature</span>
                            </div>
                        </div>
                        <div class="manometro-scale">
                            <span>0°C</span>
                            <span>50°C</span>
                        </div>
                        <div class="manometro-ideal-badge">Ideal: 18°C to 26°C</div>
                    </div>

                    <!-- Humidity Gauge -->
                    <div class="manometro-box">
                        <div class="manometro-canvas-wrapper">
                            <canvas id="gauge-umid-${dev.numero_serie}"></canvas>
                            <div class="manometro-center-info">
                                <span class="manometro-val" id="umid-val-${dev.numero_serie}" style="color: ${umidColor};">${umidDisplay}</span>
                                <span class="manometro-label">Humidity</span>
                            </div>
                        </div>
                        <div class="manometro-scale">
                            <span>0%</span>
                            <span>100%</span>
                        </div>
                        <div class="manometro-ideal-badge">Ideal: 30% to 60%</div>
                    </div>
                </div>

                <div class="sensor-card-footer">
                    <div class="sensor-extra-pill">
                        <span>CO2:</span>
                        <strong id="co2-val-${dev.numero_serie}">${co2Text}</strong>
                    </div>
                    <div class="sensor-details-hint">
                        <span>View details</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const countPill = document.getElementById('devicesCountPill');
    if (countPill) {
        countPill.innerText = `${devices.length} device${devices.length !== 1 ? 's' : ''}`;
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
            cardStatusGeral.innerText = 'Critical';
            cardStatusGeral.style.color = '#dc2626';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = `${countCritico} device(s) in critical state!`;
        } else if (countAtencao > 0) {
            cardStatusGeral.innerText = 'Warning';
            cardStatusGeral.style.color = '#f59e0b';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = `${countAtencao} device(s) outside ideal range`;
        } else {
            cardStatusGeral.innerText = 'Operational';
            cardStatusGeral.style.color = '#10b981';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = 'All parameters within range';
        }
    }
}

// ----------------------------------------------------
// 2. WARNINGS & ALERTS IN HEADER
// ----------------------------------------------------
async function fetchAlertsFromApi() {
    try {
        const res = await fetch(`${API_BASE}/api/lfg60/alertas?unreadOnly=true`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('Failed to fetch alerts.');
        const result = await res.json();

        if (result.success) {
            currentAlerts = result.data || [];
            updateHeaderAlertBadge(result.summary ? result.summary.unread : currentAlerts.length);
            renderAlertsList();

            const cardCountAlertas = document.getElementById('cardCountAlertas');
            if (cardCountAlertas) cardCountAlertas.innerText = result.summary ? result.summary.unread : currentAlerts.length;
        }
    } catch (err) {
        console.warn('[LFG60 Alerts] Error loading alerts:', err.message);
    }
}

function updateHeaderAlertBadge(unreadCount) {
    const badge = document.getElementById('headerAlertBadge');
    if (!badge) return;

    badge.innerText = unreadCount;
    if (unreadCount > 0) {
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

function toggleHeaderAlerts() {
    const popover = document.getElementById('headerAlertsPopover');
    if (!popover) return;
    popover.classList.toggle('active');
}

function filterAlerts(filterType, element) {
    activeAlertFilter = filterType;

    const tabs = document.querySelectorAll('.popover-filters .filter-tab');
    tabs.forEach(t => t.classList.remove('active'));
    if (element) element.classList.add('active');

    renderAlertsList();
}

function renderAlertsList() {
    const list = document.getElementById('headerAlertsList');
    if (!list) return;

    let filtered = currentAlerts;
    if (activeAlertFilter === 'Critico') {
        filtered = currentAlerts.filter(a => a.nivel === 'Critico' || a.nivel === 'Critical');
    } else if (activeAlertFilter === 'Aviso') {
        filtered = currentAlerts.filter(a => a.nivel === 'Aviso' || a.nivel === 'Warning');
    }

    if (filtered.length === 0) {
        list.innerHTML = `<div class="alerts-empty">No pending warnings or alerts at this time.</div>`;
        return;
    }

    list.innerHTML = filtered.map(a => {
        const isCrit = a.nivel === 'Critico' || a.nivel === 'Critical';
        const levelText = isCrit ? 'Critical' : 'Warning';
        const dateStr = a.created_at ? new Date(a.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
        
        return `
            <div class="alert-item-card ${isCrit ? 'critico' : ''}">
                <div class="alert-item-header">
                    <span class="alert-device-name">Device: ${a.dispositivo_numero_serie}</span>
                    <span class="alert-badge-pill ${isCrit ? 'critico' : 'aviso'}">${levelText}</span>
                </div>
                <div class="alert-msg-text"><strong>${a.parametro}:</strong> ${a.mensagem}</div>
                <div class="alert-item-footer">
                    <span>${dateStr}</span>
                    <button class="btn-read-alert" onclick="markAlertAsRead(${a.id})">Mark as Read</button>
                </div>
            </div>
        `;
    }).join('');
}

async function markAlertAsRead(alertId) {
    try {
        const res = await fetch(`${API_BASE}/api/lfg60/alertas/${alertId}/lido`, {
            method: 'PUT',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            fetchAlertsFromApi();
        }
    } catch (e) {
        console.error('Error marking alert as read:', e);
    }
}

async function markAllAlertsAsRead() {
    try {
        const res = await fetch(`${API_BASE}/api/lfg60/alertas/limpar-todos`, {
            method: 'PUT',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            fetchAlertsFromApi();
        }
    } catch (e) {
        console.error('Error clearing alerts:', e);
    }
}

// ----------------------------------------------------
// 3. DEVICE DETAIL MODAL
// ----------------------------------------------------
function openDeviceDetailModal(numeroSerie) {
    const dev = currentDevices.find(d => d.numero_serie === numeroSerie);
    if (!dev) return;

    const modal = document.getElementById('sensorModal');
    document.getElementById('modalSensorTitle').innerText = `Transmitter: ${dev.numero_serie}`;
    document.getElementById('modalLocationText').innerText = `Serial Number: ${dev.numero_serie}`;

    const l = dev.ultima_leitura || {};
    const timestampStr = l.timestamp ? new Date(l.timestamp).toLocaleString('en-US') : 'No reading records';
    document.getElementById('modalLastTimestamp').innerText = `Last Reading: ${timestampStr}`;

    const led = dev.led || 'Verde';
    const dot = document.getElementById('modalLedDot');
    const ledText = document.getElementById('modalLedText');
    const devStatus = document.getElementById('modalDeviceStatus');

    if (dot) {
        const isRed = led === 'Vermelho' || led === 'Red';
        const isYellow = led === 'Amarelo' || led === 'Yellow';
        dot.style.background = isRed ? '#dc2626' : (isYellow ? '#f59e0b' : '#10b981');
    }
    if (ledText) ledText.innerText = `Indicator LED: ${translateLed(led)}`;
    if (devStatus) devStatus.innerText = `Overall Status: ${translateStatus(dev.status)}`;

    // Render 7 Environmental Parameters
    const grid = document.getElementById('modalParamsGrid');
    if (grid) {
        grid.innerHTML = `
            ${renderParamCard('Temperature', l.temperatura, '°C', '18.0 - 26.0 °C', l.temperatura < 18 || l.temperatura > 26)}
            ${renderParamCard('Relative Humidity', l.umidade, '%', '30.0 - 60.0 %', l.umidade < 30 || l.umidade > 60)}
            ${renderParamCard('CO2', l.co2, 'ppm', '≤ 800 ppm', l.co2 > 800)}
            ${renderParamCard('PM2.5', l.pm25, 'µg/m³', '≤ 15 µg/m³', l.pm25 > 15)}
            ${renderParamCard('PM10', l.pm10, 'µg/m³', '≤ 30 µg/m³', l.pm10 > 30)}
            ${renderParamCard('VOC', l.voc, 'ppm', '≤ 0.20 ppm', l.voc > 0.20)}
            ${renderParamCard('Formaldehyde', l.formaldeido, 'mg/m³', '≤ 0.05 mg/m³', l.formaldeido > 0.05)}
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
            const temp = Number((27.0 + Math.sin(i * 0.6) * 8.5).toFixed(1));
            const umid = Number((48.5 + Math.cos(i * 0.4) * 6.5).toFixed(1));
            const co2 = Math.round(580 + Math.sin(i * 0.5) * 120);
            const isWarn = temp < 18 || temp > 26 || umid < 30 || umid > 60 || co2 > 800;
            const isCrit = temp < 15 || temp > 30 || umid < 20 || umid > 75 || co2 > 1200;
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
            const time = new Date(item.timestamp_leitura).toLocaleString('en-US');
            const ledColor = item.led === 'Red' ? '#ef4444' : (item.led === 'Yellow' ? '#f59e0b' : '#10b981');
            return `
                <div style="padding: 6px 0; border-bottom: 1px dashed #334155; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                    <div>
                        <span style="color: ${ledColor}; font-weight: bold;">● [${item.led}]</span> 
                        <span style="color: #94a3b8;">${time}</span>
                    </div>
                    <div style="text-align: right; color: #e2e8f0;">
                        Temp: <strong>${item.temperatura}°C</strong> | 
                        Humidity: <strong>${item.umidade}%</strong> | 
                        CO2: <strong>${item.co2} ppm</strong>
                    </div>
                </div>
            `;
        }).join('');
        return;
    }

    historyContainer.innerHTML = `<div style="color: #94a3b8;">Loading history from database...</div>`;

    try {
        const res = await fetch(`${API_BASE}/api/lfg60/${numeroSerie}/leituras`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('Error fetching readings history.');
        const result = await res.json();

        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
            historyContainer.innerHTML = result.data.map(item => {
                const time = item.timestamp_leitura ? new Date(item.timestamp_leitura).toLocaleString('en-US') : (item.created_at ? new Date(item.created_at).toLocaleString('en-US') : 'N/A');
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
                            Humidity: <strong>${item.umidade !== null ? item.umidade + '%' : '--'}</strong> | 
                            CO2: <strong>${item.co2 !== null ? item.co2 + ' ppm' : '--'}</strong>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            historyContainer.innerHTML = `<div style="color: #94a3b8;">No historical records found.</div>`;
        }
    } catch (err) {
        console.warn('[LFG60] Error loading history:', err.message);
        historyContainer.innerHTML = `<div style="color: #ef4444;">Error loading history from API.</div>`;
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
            
            const hasMin = l.min_ideal !== undefined;
            const inputStyle = 'width: 50px; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 4px; padding: 4px 2px; text-align: center; font-size: 12px; margin: 0 2px;';
            const translatedLabel = translateParamKey(key);
            
            html += `
            <tr data-param="${key}">
                <td style="white-space: nowrap;"><strong>${translatedLabel}</strong></td>
                <td>${l.unit}</td>
                <td style="white-space: nowrap;">
                    ${hasMin ? 
                        `<input type="number" step="0.1" class="input-limite" data-field="min_ideal" value="${l.min_ideal}" style="${inputStyle}"> to 
                         <input type="number" step="0.1" class="input-limite" data-field="max_ideal" value="${l.max_ideal}" style="${inputStyle}">` 
                        : 
                        `&le; <input type="number" step="0.1" class="input-limite" data-field="max_ideal" value="${l.max_ideal}" style="${inputStyle}">`
                    }
                </td>
                <td style="color: #f59e0b; white-space: nowrap; font-size: 12px;">
                    ${hasMin ? 
                        `Outside Ideal` 
                        : 
                        `Up to <input type="number" step="0.1" class="input-limite" data-field="max_aviso" value="${l.max_aviso}" style="${inputStyle}">`
                    }
                </td>
                <td style="color: #ef4444; white-space: nowrap; font-size: 12px;">
                    ${hasMin ? 
                        `&lt; <input type="number" step="0.1" class="input-limite" data-field="crit_min" value="${l.crit_min}" style="${inputStyle}"> or 
                         &gt; <input type="number" step="0.1" class="input-limite" data-field="crit_max" value="${l.crit_max}" style="${inputStyle}">` 
                        : 
                        `&gt; Max Warning`
                    }
                </td>
            </tr>
            `;
        });
        tbody.innerHTML = html;
        
        modal.classList.add('active');
    } catch (e) {
        console.error('Error opening limits modal:', e);
        alert('Error loading limits from database.');
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
            novosLimites[param][field] = input.value !== '' ? Number(input.value) : '';
        });
    });
    
    try {
        const res = await fetch(`${API_BASE}/api/lfg60/limites`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(novosLimites)
        });
        
        if (res.ok) {
            alert('Limits updated successfully!');
            closeRangesModal();
            loadDashboardData();
        } else {
            alert('Error updating limits.');
        }
    } catch (e) {
        console.error('Error saving limits:', e);
        alert('Error connecting to API.');
    }
}

document.addEventListener('click', function(e) {
    const sensorModal = document.getElementById('sensorModal');
    const rangesModal = document.getElementById('rangesModal');

    if (sensorModal && e.target === sensorModal) closeSensorModal();
    if (rangesModal && e.target === rangesModal) closeRangesModal();
});

function toggleNavDropdown(btn) {
    const dropdown = btn.closest('.nav-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');
    }
}

// ----------------------------------------------------
// 6. FULLSCREEN UNITARY PRESENTATION (KIOSK / TV)
// ----------------------------------------------------
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
        textEl.innerText = isFull ? 'Exit Fullscreen' : 'Fullscreen';
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
        select.innerHTML = '<option value="">No transmitters</option>';
        return;
    }

    select.innerHTML = currentDevices.map((d, idx) => `
        <option value="${d.numero_serie}">Transmitter ${d.numero_serie} (${idx + 1}/${currentDevices.length})</option>
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
    switch (param) {
        case 'temperatura':
            if (v >= 18 && v <= 26) return { text: 'Ideal', cls: 'ideal' };
            if ((v >= 15 && v < 18) || (v > 26 && v <= 30)) return { text: 'Warning', cls: 'aviso' };
            return { text: 'Critical', cls: 'critico' };
        case 'umidade':
            if (v >= 30 && v <= 60) return { text: 'Ideal', cls: 'ideal' };
            if ((v >= 20 && v < 30) || (v > 60 && v <= 75)) return { text: 'Warning', cls: 'aviso' };
            return { text: 'Critical', cls: 'critico' };
        case 'co2':
            if (v <= 800) return { text: 'Normal', cls: 'ideal' };
            if (v <= 1200) return { text: 'Warning', cls: 'aviso' };
            return { text: 'Critical', cls: 'critico' };
        case 'pm25':
            if (v <= 15) return { text: 'Normal', cls: 'ideal' };
            if (v <= 25) return { text: 'Warning', cls: 'aviso' };
            return { text: 'Critical', cls: 'critico' };
        case 'pm10':
            if (v <= 30) return { text: 'Normal', cls: 'ideal' };
            if (v <= 50) return { text: 'Warning', cls: 'aviso' };
            return { text: 'Critical', cls: 'critico' };
        case 'voc':
            if (v <= 0.20) return { text: 'Normal', cls: 'ideal' };
            if (v <= 0.50) return { text: 'Warning', cls: 'aviso' };
            return { text: 'Critical', cls: 'critico' };
        case 'formaldeido':
            if (v <= 0.05) return { text: 'Normal', cls: 'ideal' };
            if (v <= 0.10) return { text: 'Warning', cls: 'aviso' };
            return { text: 'Critical', cls: 'critico' };
        default:
            return { text: 'Normal', cls: 'ideal' };
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

function renderFullscreenDevice(index) {
    if (!currentDevices || currentDevices.length === 0) return;

    if (index < 0) index = currentDevices.length - 1;
    if (index >= currentDevices.length) index = 0;
    fullscreenActiveIndex = index;

    const dev = currentDevices[index];
    const l = dev.ultima_leitura || {};

    // 1. Update Device Header
    const titleEl = document.getElementById('fsDeviceTitle');
    if (titleEl) titleEl.innerText = `Transmitter ${dev.numero_serie}`;

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
        const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleString('en-US') : 'Waiting for first reading';
        lastTimeEl.innerText = `Last Reading: ${timeStr}`;
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

    fsGaugeTempChart = updateFullscreenGaugeChart(fsGaugeTempChart, 'fsGaugeTempCanvas', tempVal, 0, 50, tempColor);
    fsGaugeUmidChart = updateFullscreenGaugeChart(fsGaugeUmidChart, 'fsGaugeUmidCanvas', umidVal, 0, 100, umidColor);

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
            diagBadge.innerText = 'Stable';
            diagEval.innerText = 'All 7 parameters in compliance';
            diagEval.style.color = '#059669';
        } else {
            diagBadge.className = 'fs-param-status aviso';
            diagBadge.innerText = 'Warning';
            diagEval.innerText = `${outCount} parameter(s) outside ideal range`;
            diagEval.style.color = '#d97706';
        }
    }

    // 5. Update Indicators (Dots) and Counter
    renderFsDots();
    const counterEl = document.getElementById('fsDeviceCounterText');
    if (counterEl) {
        counterEl.innerText = `Device ${fullscreenActiveIndex + 1} of ${currentDevices.length}`;
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
    }
}

function renderFsDots() {
    const dotsContainer = document.getElementById('fsCarouselDots');
    if (!dotsContainer || !currentDevices) return;

    dotsContainer.innerHTML = currentDevices.map((_, idx) => `
        <div class="fs-dot ${idx === fullscreenActiveIndex ? 'active' : ''}" 
             onclick="renderFullscreenDevice(${idx})" 
             title="Go to transmitter ${idx + 1}"></div>
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
    if (text) text.innerText = 'Pause (8s)';
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
    if (!currentDevices || currentDevices.length === 0) return;
    populateFsDeviceSelect();
    renderFullscreenDevice(fullscreenActiveIndex);
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
            dot.title = `Go to device ${idx + 1}`;
            dot.onclick = () => scrollCarouselToIndex(idx);
            indicatorsContainer.appendChild(dot);
        });
    } else if (indicatorsContainer && (!hasOverflow || cards.length <= 1)) {
        indicatorsContainer.innerHTML = '';
    }
}
