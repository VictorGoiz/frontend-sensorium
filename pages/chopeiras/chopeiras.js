let currentChopeiras = [];
let chopeirasChartInstance = null;
let socketInstance = null;
let isUpdatingDashboard = false;
let lastChartSignature = '';
let lastDevicesSignature = '';
let liveBadgeWatchdog = null;

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

        chopeirasChartInstance.data.labels.push(nowLabel);
        chopeirasChartInstance.data.datasets[0].data.push(sensor1 !== null && sensor1 !== undefined ? Number(sensor1) : null);
        chopeirasChartInstance.data.datasets[1].data.push(rele1_on !== null && rele1_on !== undefined ? Number(rele1_on) : null);
        chopeirasChartInstance.data.datasets[2].data.push(rele1_off !== null && rele1_off !== undefined ? Number(rele1_off) : null);

        if (chopeirasChartInstance.data.labels.length > 20) {
            chopeirasChartInstance.data.labels.shift();
            chopeirasChartInstance.data.datasets.forEach(ds => ds.data.shift());
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
    const r1On = data.map(d => d.rele1_on !== null ? Number(d.rele1_on) : null);
    const r1Off = data.map(d => d.rele1_off !== null ? Number(d.rele1_off) : null);

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
                    borderWidth: 1.6,
                    borderDash: [],
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.25,
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
                    borderWidth: 1.6,
                    borderDash: [],
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.25,
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
                duration: 120,
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
                    display: false // Usamos a legenda inline personalizada com linhas finas
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
                    grace: '10%',
                    grid: { color: 'rgba(226, 232, 240, 0.6)', drawBorder: false },
                    ticks: { color: '#64748b', maxTicksLimit: 7, font: { size: 11, family: 'Inter' } }
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
