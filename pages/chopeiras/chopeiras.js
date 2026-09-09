let currentChopeiras = [];
let selectedDeviceSerial = '';
let chopeirasChartInstance = null;
let socketInstance = null;
let isUpdatingDashboard = false;
let lastChartSignature = '';
let lastDevicesSignature = '';
let liveBadgeWatchdog = null;

// Estado do Modal de Registros
let registrosCurrentPage = 1;
let registrosTotalPages = 1;
const registrosPageLimit = 20;
let isFetchingRegistros = false;


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

        // Reseta watchdog de 15 segundos para voltar a cinza se parar de receber dados
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
    loadChopeirasData();

    // Polling contínuo ultrarrápido (150ms) para sincronia com milissegundos
    setInterval(() => {
        loadChopeirasData(true);
    }, 150);

    // Monitora mudanças de tela cheia para atualizar botão
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
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                transports: ['websocket', 'polling']
            });

            socketInstance.on('connect', () => {
                console.log('[Chopeiras Socket] Conectado em tempo real.');
            });

            // Recepção instantânea de leituras (latência zero)
            socketInstance.on('rele_reading', (data) => {
                handleLiveChopeiraReading(data);
            });

            socketInstance.on('dashboard_update', (data) => {
                if (data?.data && data.type === 'reles_data') {
                    handleLiveChopeiraReading(data.data);
                } else {
                    loadChopeirasData(false);
                }
            });

            socketInstance.on('disconnect', () => {
                console.warn('[Chopeiras Socket] Desconectado.');
                setLiveBadgeState(false);
            });
        } catch (err) {
            console.error('[Chopeiras Socket] Erro ao conectar:', err);
            setLiveBadgeState(false);
        }
    }
}

/**
 * Carrega todos os dados das chopeiras via API
 */
async function loadChopeirasData(silent = false) {
    if (isUpdatingDashboard) return;
    isUpdatingDashboard = true;

    try {
        const res = await fetch(`${API_BASE}/api/reles`);
        if (!res.ok) throw new Error('Falha ao obter lista de chopeiras.');
        const result = await res.json();

        if (result.success && Array.isArray(result.data)) {
            currentChopeiras = result.data;
            populateChopeirasSelect(currentChopeiras);
            renderChopeirasGrid(currentChopeiras);
            updateExecutiveSummary(currentChopeiras);

            // Verifica se há dados recebidos para ativar a badge
            const hasData = currentChopeiras.length > 0 && currentChopeiras.some(d => d.ultima_leitura && d.ultima_leitura.sensor1 !== null && d.ultima_leitura.sensor1 !== undefined);
            if (hasData) {
                setLiveBadgeState(true);
            } else if (currentChopeiras.length === 0) {
                setLiveBadgeState(false);
            }

            // Atualiza o gráfico se houver dispositivo selecionado
            if (selectedDeviceSerial) {
                loadChopeiraChart(selectedDeviceSerial, false);
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

    // 2. Se for a chopeira ativa na apresentação, atualiza os cards executivos
    if (selectedDeviceSerial === numeroSerie) {
        updateActiveExecutiveCard(reading);
    }

    // 3. Atualiza o card específico no grid
    const cardEl = document.querySelector(`.chopeira-card[data-serie="${numeroSerie}"]`);
    if (cardEl) {
        const pressureEl = cardEl.querySelector('.chopeira-pressure-val');
        if (pressureEl && sensor1 !== null && sensor1 !== undefined) {
            pressureEl.innerText = `${Number(sensor1).toFixed(2)} bar`;
        }
    }

    // 4. Se o gráfico estiver exibindo esta chopeira, faz streaming instantâneo
    if (selectedDeviceSerial === numeroSerie && chopeirasChartInstance) {
        const nowLabel = new Date(timestamp || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // Identifica os valores fixos de setpoint
        let curSetpointOn = rele1_on !== null && rele1_on !== undefined ? Number(rele1_on) : null;
        let curSetpointOff = rele1_off !== null && rele1_off !== undefined ? Number(rele1_off) : null;

        if (curSetpointOn === null && dev?.ultima_leitura?.rele1_on !== null && dev?.ultima_leitura?.rele1_on !== undefined) {
            curSetpointOn = Number(dev.ultima_leitura.rele1_on);
        }
        if (curSetpointOff === null && dev?.ultima_leitura?.rele1_off !== null && dev?.ultima_leitura?.rele1_off !== undefined) {
            curSetpointOff = Number(dev.ultima_leitura.rele1_off);
        }

        if (curSetpointOn === null && chopeirasChartInstance.data.datasets[1]?.data?.length > 0) {
            curSetpointOn = chopeirasChartInstance.data.datasets[1].data.find(v => v !== null && v !== undefined) ?? null;
        }
        if (curSetpointOff === null && chopeirasChartInstance.data.datasets[2]?.data?.length > 0) {
            curSetpointOff = chopeirasChartInstance.data.datasets[2].data.find(v => v !== null && v !== undefined) ?? null;
        }

        chopeirasChartInstance.data.labels.push(nowLabel);
        // Apenas a pressão varia conforme as leituras recebidas do banco/sensor
        chopeirasChartInstance.data.datasets[0].data.push(sensor1 !== null && sensor1 !== undefined ? Number(sensor1) : null);

        // Linhas de setpoint fixas e constantes em todos os pontos
        chopeirasChartInstance.data.datasets[1].data = chopeirasChartInstance.data.labels.map(() => curSetpointOn);
        chopeirasChartInstance.data.datasets[2].data = chopeirasChartInstance.data.labels.map(() => curSetpointOff);

        if (chopeirasChartInstance.data.labels.length > 20) {
            chopeirasChartInstance.data.labels.shift();
            chopeirasChartInstance.data.datasets[0].data.shift();
            chopeirasChartInstance.data.datasets[1].data.shift();
            chopeirasChartInstance.data.datasets[2].data.shift();
        }

        chopeirasChartInstance.update();
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

    if (serialEl) serialEl.innerText = reading.numeroSerie || '--';

    if (pressEl && reading.sensor1 !== null && reading.sensor1 !== undefined) {
        pressEl.innerText = Number(reading.sensor1).toFixed(2);
        pressEl.classList.add('pulse');
        setTimeout(() => pressEl.classList.remove('pulse'), 150);
    }

    if (r1OnEl) r1OnEl.innerText = reading.rele1_on !== null && reading.rele1_on !== undefined ? Number(reading.rele1_on).toFixed(1) : '--';
    if (r1OffEl) r1OffEl.innerText = reading.rele1_off !== null && reading.rele1_off !== undefined ? Number(reading.rele1_off).toFixed(1) : '--';
    if (r1AcEl) r1AcEl.innerText = reading.rele1_acionamentos ?? '--';
    if (r1StatusEl) {
        r1StatusEl.innerText = (reading.rele1_on !== null && reading.sensor1 >= reading.rele1_on) ? 'ATIVO (ON)' : 'DESLIGADO (OFF)';
        r1StatusEl.style.color = (reading.rele1_on !== null && reading.sensor1 >= reading.rele1_on) ? '#10b981' : '#64748b';
    }

    if (r2OnEl) r2OnEl.innerText = reading.rele2_on !== null && reading.rele2_on !== undefined ? Number(reading.rele2_on).toFixed(1) : '--';
    if (r2OffEl) r2OffEl.innerText = reading.rele2_off !== null && reading.rele2_off !== undefined ? Number(reading.rele2_off).toFixed(1) : '--';
    if (r2AcEl) r2AcEl.innerText = reading.rele2_acionamentos ?? '--';
    if (r2StatusEl) {
        r2StatusEl.innerText = (reading.rele2_on !== null && reading.sensor1 >= reading.rele2_on) ? 'ATIVO (ON)' : 'DESLIGADO (OFF)';
        r2StatusEl.style.color = (reading.rele2_on !== null && reading.sensor1 >= reading.rele2_on) ? '#10b981' : '#64748b';
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
 * Renderiza o Grid de Chopeiras
 */
function renderChopeirasGrid(devices) {
    const grid = document.getElementById('chopeirasGrid');
    if (!grid) return;

    if (devices.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-muted);">Nenhuma chopeira conectada.</div>';
        return;
    }

    const sig = JSON.stringify(devices.map(d => ({
        s: d.numero_serie,
        st: d.status,
        ts: d.ultima_leitura?.timestamp,
        s1: d.ultima_leitura?.sensor1
    })));

    if (lastDevicesSignature === sig) return;
    lastDevicesSignature = sig;

    grid.innerHTML = devices.map(d => {
        const l = d.ultima_leitura || {};
        const press = l.sensor1 !== null && l.sensor1 !== undefined ? Number(l.sensor1).toFixed(2) : '--';
        const isSel = d.numero_serie === selectedDeviceSerial;
        const dotClass = d.status === 'Crítico' ? 'red' : (d.status === 'Atenção' ? 'yellow' : 'green');
        const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleTimeString('pt-BR') : 'Sem leitura';

        return `
            <div class="chopeira-card ${isSel ? 'selected' : ''}" data-serie="${d.numero_serie}" onclick="selectChopeira('${d.numero_serie}')">
                <div class="chopeira-card-header">
                    <span class="chopeira-card-title">Chopeira #${d.numero_serie}</span>
                    <span class="status-dot-fine ${dotClass}" title="${d.status || 'Operacional'}"></span>
                </div>
                <div class="chopeira-card-body">
                    <div class="chopeira-row">
                        <span>Pressão Atual:</span>
                        <strong class="chopeira-live-val chopeira-pressure-val" style="color: var(--primary-blue); font-size: 14px;">${press} bar</strong>
                    </div>
                    <div class="chopeira-row">
                        <span>Última Transmissão:</span>
                        <span>${timeStr}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
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
        const res = await fetch(`${API_BASE}/api/reles/${serial}/leituras?periodo=${periodo}`);
        if (!res.ok) throw new Error('Erro ao carregar telemetria');
        const result = await res.json();

        if (result.success && Array.isArray(result.data)) {
            let chronologicalData = result.data.slice().reverse();

            if (periodo === 'all' && chronologicalData.length > 20) {
                chronologicalData = chronologicalData.slice(-20);
            }

            renderChopeirasChart(chronologicalData, serial, periodo, forceRedraw);
        }
    } catch (err) {
        console.warn('[Chopeiras Chart] Erro:', err.message);
    }
}

/**
 * Cria ou atualiza o gráfico Chart.js com linhas finas e tema #1e60ac
 */
function renderChopeirasChart(data, serial = '', periodo = '', forceRedraw = false) {
    const ctx = document.getElementById('chopeirasChart');
    if (!ctx) return;

    const sig = `${serial}_${periodo}_` + data.map(d => `${d.id || ''}_${d.sensor1}_${d.rele1_on}_${d.rele1_off}_${d.timestamp_leitura || d.created_at}`).join('|');

    if (!forceRedraw && lastChartSignature === sig && chopeirasChartInstance) {
        return;
    }
    lastChartSignature = sig;

    const labels = data.map(d => {
        const t = d.timestamp_leitura || d.created_at;
        return t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    });

    const sensor1 = data.map(d => d.sensor1 !== null ? Number(d.sensor1) : null);

    // Identifica os valores fixos de Setpoint ON e OFF para o dispositivo
    let setpointOn = null;
    let setpointOff = null;

    const dev = currentChopeiras.find(d => d.numero_serie === serial);
    if (dev && dev.ultima_leitura) {
        if (dev.ultima_leitura.rele1_on !== null && dev.ultima_leitura.rele1_on !== undefined) {
            setpointOn = Number(dev.ultima_leitura.rele1_on);
        }
        if (dev.ultima_leitura.rele1_off !== null && dev.ultima_leitura.rele1_off !== undefined) {
            setpointOff = Number(dev.ultima_leitura.rele1_off);
        }
    }

    if (setpointOn === null) {
        for (let i = data.length - 1; i >= 0; i--) {
            if (data[i].rele1_on !== null && data[i].rele1_on !== undefined) {
                setpointOn = Number(data[i].rele1_on);
                break;
            }
        }
    }
    if (setpointOff === null) {
        for (let i = data.length - 1; i >= 0; i--) {
            if (data[i].rele1_off !== null && data[i].rele1_off !== undefined) {
                setpointOff = Number(data[i].rele1_off);
                break;
            }
        }
    }

    // Linhas de setpoint fixas constantes para todos os pontos no gráfico
    const r1On = labels.map(() => setpointOn);
    const r1Off = labels.map(() => setpointOff);

    if (chopeirasChartInstance) {
        chopeirasChartInstance.data.labels = labels;
        chopeirasChartInstance.data.datasets[0].data = sensor1;
        chopeirasChartInstance.data.datasets[1].data = r1On;
        chopeirasChartInstance.data.datasets[2].data = r1Off;

        chopeirasChartInstance.update();
        return;
    }

    chopeirasChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Pressão da Chopeira (Sensor 1)',
                    data: sensor1,
                    borderColor: '#1e60ac', // Azul Principal Sensorium
                    backgroundColor: 'rgba(30, 96, 172, 0.08)',
                    borderWidth: 2.2, // Linha fina e nítida
                    borderDash: [],
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHitRadius: 8,
                    tension: 0.45,
                    borderCapStyle: 'round',
                    borderJoinStyle: 'round',
                    cubicInterpolationMode: 'monotone',
                    spanGaps: true,
                    fill: true,
                    normalized: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Setpoint ON',
                    data: r1On,
                    borderColor: '#10b981', // Verde Esmeralda fino
                    backgroundColor: 'transparent',
                    borderWidth: 1.8,
                    borderDash: [6, 6],
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0, // Linha reta fixa
                    borderCapStyle: 'round',
                    borderJoinStyle: 'round',
                    spanGaps: true,
                    fill: false,
                    normalized: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Setpoint OFF',
                    data: r1Off,
                    borderColor: '#ef4444', // Vermelho fino
                    backgroundColor: 'transparent',
                    borderWidth: 1.8,
                    borderDash: [6, 6],
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0, // Linha reta fixa
                    borderCapStyle: 'round',
                    borderJoinStyle: 'round',
                    spanGaps: true,
                    fill: false,
                    normalized: true,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 150,
                easing: 'easeOutCubic'
            },
            transitions: {
                active: {
                    animation: {
                        duration: 80,
                        easing: 'easeOutCubic'
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: false // Legenda inline personalizada
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.92)',
                    titleColor: '#f8fafc',
                    bodyColor: '#cbd5e1',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y !== null ? context.parsed.y : '--'} bar`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b', maxTicksLimit: 6, font: { size: 11, family: 'Inter' } }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 0,
                    max: 100,
                    grid: { color: 'rgba(226, 232, 240, 0.6)', drawBorder: false },
                    ticks: {
                        color: '#64748b',
                        stepSize: 20,
                        font: { size: 11, family: 'Inter' },
                        callback: function(value) {
                            return value + ' bar';
                        }
                    }
                }
            }
        }
    });
}

/**
 * Alterna o modo de Tela Cheia (Fullscreen Kiosk / TV)
 */
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
        textEl.innerText = isFull ? 'Sair da Tela Cheia' : 'Tela Cheia';
    }

    if (iconEl) {
        if (isFull) {
            iconEl.innerHTML = '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>';
        } else {
            iconEl.innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>';
        }
    }

    if (chopeirasChartInstance) {
        setTimeout(() => chopeirasChartInstance.resize(), 100);
    }
}

/**
 * Alterna o Dropdown de Apresentação na Sidebar
 */
function toggleNavDropdown(btn) {
    const dropdown = btn.closest('.nav-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');
    }
}

/* ==========================================================================
   MODAL DE REGISTROS DE LEITURAS DOS RELÉS & EXPORTAÇÃO / EXCLUSÃO
   ========================================================================== */

/**
 * Abre o modal de registros de leituras
 */
function openRegistrosModal() {
    const modal = document.getElementById('registrosModal');
    if (!modal) return;

    // Popula select de dispositivos do modal
    const filterDevSelect = document.getElementById('filterModalDispositivo');
    if (filterDevSelect) {
        filterDevSelect.innerHTML = '<option value="todos">Todos os Dispositivos</option>';
        currentChopeiras.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.numero_serie;
            opt.textContent = `Chopeira #${d.numero_serie}`;
            filterDevSelect.appendChild(opt);
        });

        // Se houver dispositivo ativo selecionado na página, pré-seleciona ele
        if (selectedDeviceSerial) {
            filterDevSelect.value = selectedDeviceSerial;
        }
    }

    limparFeedbackModal();
    modal.classList.add('active');
    document.addEventListener('keydown', handleRegistrosEscKey);

    // Carrega primeira página de registros
    carregarRegistrosModal(1);
}

/**
 * Fecha o modal de registros
 */
function closeRegistrosModal() {
    const modal = document.getElementById('registrosModal');
    if (modal) {
        modal.classList.remove('active');
    }
    fecharConfirmacaoExclusao();
    document.removeEventListener('keydown', handleRegistrosEscKey);
}

function handleRegistrosModalBackdrop(event) {
    if (event.target && event.target.id === 'registrosModal') {
        closeRegistrosModal();
    }
}

function handleRegistrosEscKey(e) {
    if (e.key === 'Escape') {
        const confirmModal = document.getElementById('confirmDeleteModal');
        if (confirmModal && confirmModal.classList.contains('active')) {
            fecharConfirmacaoExclusao();
        } else {
            closeRegistrosModal();
        }
    }
}

/**
 * Carrega registros da API com filtros e paginação
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
        tableBody.innerHTML = '<tr><td colspan="9" class="table-state-message">Consultando registros no servidor...</td></tr>';
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
        const res = await fetch(`${API_BASE}/api/reles/registros?${params.toString()}`);
        if (!res.ok) throw new Error('Falha ao consultar registros de relés.');
        const result = await res.json();

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
            throw new Error(result.message || 'Erro ao carregar registros.');
        }
    } catch (err) {
        console.error('[Registros Modal] Erro:', err);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="9" class="table-state-message" style="color: var(--status-red);">Erro ao carregar registros: ${err.message}</td></tr>`;
        }
    } finally {
        isFetchingRegistros = false;
    }
}

/**
 * Formata data e hora de leituras com exatidão máxima de segundos e sem distorção de fuso horário
 */
function formatarDataHoraLeitura(row) {
    if (!row) return '--';
    const str = row.timestamp_formatado || row.timestamp_leitura || row.created_at;
    if (!str) return '--';

    const s = String(str).trim();
    // Se vier no formato SQL exato "YYYY-MM-DD HH:mm:ss" ou "YYYY-MM-DDTHH:mm:ss"
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)) {
        const [datePart, timePart] = s.replace('T', ' ').split(' ');
        const [yyyy, mm, dd] = datePart.split('-');
        return `${dd}/${mm}/${yyyy} ${timePart.slice(0, 8)}`;
    }

    const d = new Date(str);
    if (isNaN(d.getTime())) return String(str);
    return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

/**
 * Renderiza as linhas da tabela de registros
 */
function renderTabelaRegistros(rows) {
    const tableBody = document.getElementById('registrosTableBody');
    if (!tableBody) return;

    if (!rows || rows.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" class="table-state-message">Nenhum registro encontrado para os filtros selecionados.</td></tr>';
        return;
    }

    tableBody.innerHTML = rows.map(r => {
        const formattedDate = formatarDataHoraLeitura(r);
        const pressaoVal = (r.sensor1 !== null && r.sensor1 !== undefined) ? `${Number(r.sensor1).toFixed(2)} bar` : '--';
        const r1OnVal = (r.rele1_on !== null && r.rele1_on !== undefined) ? `${Number(r.rele1_on).toFixed(1)} bar` : '--';
        const r1OffVal = (r.rele1_off !== null && r.rele1_off !== undefined) ? `${Number(r.rele1_off).toFixed(1)} bar` : '--';
        const r1AcVal = r.rele1_acionamentos ?? '--';

        const r2OnVal = (r.rele2_on !== null && r.rele2_on !== undefined) ? `${Number(r.rele2_on).toFixed(1)} bar` : '--';
        const r2OffVal = (r.rele2_off !== null && r.rele2_off !== undefined) ? `${Number(r.rele2_off).toFixed(1)} bar` : '--';
        const r2AcVal = r.rele2_acionamentos ?? '--';

        return `
            <tr>
                <td><span class="pill-cell blue">#${r.dispositivo_numero_serie}</span></td>
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
 * Ações de filtro e navegação
 */
function filtrarRegistrosModal() {
    limparFeedbackModal();
    carregarRegistrosModal(1);
}

function limparFiltrosRegistrosModal() {
    const filterDevSelect = document.getElementById('filterModalDispositivo');
    const dataInicioInput = document.getElementById('filterModalDataInicio');
    const dataFimInput = document.getElementById('filterModalDataFim');

    if (filterDevSelect) filterDevSelect.value = 'todos';
    if (dataInicioInput) dataInicioInput.value = '';
    if (dataFimInput) dataFimInput.value = '';

    limparFeedbackModal();
    carregarRegistrosModal(1);
}

function mudarPaginaRegistros(delta) {
    const novaPagina = registrosCurrentPage + delta;
    if (novaPagina >= 1 && novaPagina <= registrosTotalPages) {
        carregarRegistrosModal(novaPagina);
    }
}

/**
 * Exporta os registros em CSV chamando a rota /api/arquivos/exportar
 */
async function exportarRegistrosCSV() {
    const filterDev = document.getElementById('filterModalDispositivo')?.value || 'todos';
    const dataInicio = document.getElementById('filterModalDataInicio')?.value || '';
    const dataFim = document.getElementById('filterModalDataFim')?.value || '';

    const params = new URLSearchParams({
        tipo: 'reles',
        formato: 'csv',
        numeroSerie: filterDev,
        dataInicio: dataInicio,
        dataFim: dataFim
    });

    exibirFeedbackModal('Gerando arquivo CSV para download...', 'info');

    try {
        const downloadUrl = `${API_BASE}/api/arquivos/exportar?${params.toString()}`;
        
        // Efetua o download via fetch para tratar eventuais erros de forma elegante
        const res = await fetch(downloadUrl);
        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.message || 'Falha ao gerar arquivo de exportação.');
        }

        const blob = await res.blob();
        let filename = `relatorio_reles_${new Date().toISOString().slice(0, 10)}.csv`;

        // Tenta extrair filename do header se disponível
        const disposition = res.headers.get('Content-Disposition');
        if (disposition && disposition.includes('filename=')) {
            const matches = disposition.match(/filename="?([^"]+)"?/);
            if (matches && matches[1]) {
                filename = matches[1];
            }
        }

        // Dispara o download no navegador
        const link = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);

        exibirFeedbackModal(`Arquivo CSV "${filename}" baixado com sucesso!`, 'success');
    } catch (err) {
        console.error('[Exportar CSV] Erro:', err);
        exibirFeedbackModal(`Erro ao exportar CSV: ${err.message}`, 'error');
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

function fecharConfirmacaoExclusao() {
    const confirmModal = document.getElementById('confirmDeleteModal');
    if (confirmModal) confirmModal.classList.remove('active');
}

/**
 * Executa a exclusão de registros por período
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
            headers: { 'Content-Type': 'application/json' },
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

/**
 * Exibe mensagem de feedback visual no modal
 */
function exibirFeedbackModal(mensagem, tipo = 'info') {
    const box = document.getElementById('modalRegistrosFeedback');
    if (!box) return;

    box.className = `modal-feedback-box ${tipo}`;
    box.innerText = mensagem;
    box.style.display = 'block';

    if (tipo === 'success') {
        setTimeout(() => {
            if (box.innerText === mensagem) {
                limparFeedbackModal();
            }
        }, 6000);
    }
}

function limparFeedbackModal() {
    const box = document.getElementById('modalRegistrosFeedback');
    if (box) {
        box.style.display = 'none';
        box.innerText = '';
    }
}

