let mapInstance = null;
let currentDevices = [];
let currentAlerts = [];
let activeAlertFilter = 'todos';
let historyChartInstance = null;
let socketInstance = null;
let isUpdatingDashboard = false;
let lastDevicesSignature = '';
let lastChartSignature = '';

document.addEventListener('DOMContentLoaded', function() {
    initRealtimeConnection();
    loadDashboardData();

    // Polling contínuo ultrarrápido (150ms) para streaming contínuo em milissegundos
    setInterval(() => {
        loadDashboardData(true);
    }, 150);

    // Fechar popover de alertas ao clicar fora
    document.addEventListener('click', function(e) {
        const popover = document.getElementById('headerAlertsPopover');
        const alertBtn = document.getElementById('headerAlertBtn');
        if (popover && popover.classList.contains('active')) {
            if (!popover.contains(e.target) && !alertBtn.contains(e.target)) {
                popover.classList.remove('active');
            }
        }
        
        const sensorModal = document.getElementById('sensorModal');
        if (sensorModal && e.target === sensorModal) {
            closeSensorModal();
        }
    });
});

/**
 * Inicializa conexão WebSocket com Socket.IO
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
                console.log('[Socket.IO] Conectado em tempo real ao servidor.');
            });

            // Recepção instantânea de leituras em milissegundos
            socketInstance.on('rele_reading', (data) => {
                handleLiveReading(data);
            });

            socketInstance.on('dashboard_update', (data) => {
                if (data?.data && data.type === 'reles_data') {
                    handleLiveReading(data.data);
                } else {
                    loadDashboardData(false);
                }

                // Se o modal estiver aberto e o dispositivo corresponder, atualiza o modal na hora
                const modal = document.getElementById('sensorModal');
                if (modal && modal.classList.contains('active')) {
                    const title = document.getElementById('modalSensorTitle')?.innerText || '';
                    if (!data?.numeroSerie || title.includes(data.numeroSerie)) {
                        const currentModalDev = currentDevices.find(d => title.includes(d.numero_serie));
                        if (currentModalDev) {
                            updateModalLiveValues(currentModalDev);
                        }
                    }
                }
            });

            socketInstance.on('disconnect', () => {
                console.warn('[Socket.IO] Desconectado. Tentando reconectar...');
            });
        } catch (err) {
            console.error('[Socket.IO] Erro ao inicializar conexão:', err);
        }
    } else {
        console.warn('Socket.IO não disponível. Usando polling contínuo.');
    }
}

/**
 * Processa uma leitura em tempo real instantaneamente (Latência Zero)
 * Atualiza o card, o gráfico e os indicadores na hora em que a variação (ex: 50, 49, 48) ocorre
 */
function handleLiveReading(reading) {
    if (!reading || !reading.numeroSerie) return;
    const { numeroSerie, sensor1, rele1_on, rele1_off, rele1_acionamentos, rele2_on, rele2_off, rele2_acionamentos, timestamp } = reading;

    // 1. Atualiza o objeto no array de dispositivos
    let dev = currentDevices.find(d => d.numero_serie === numeroSerie);
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

    // 2. Atualiza os valores do Card específico instantaneamente
    const cardEl = document.querySelector(`.sensor-card[data-serie="${numeroSerie}"]`);
    if (cardEl) {
        const pressureEl = cardEl.querySelector('.pressure-live-val');
        if (pressureEl && sensor1 !== null && sensor1 !== undefined) {
            pressureEl.innerText = Number(sensor1).toFixed(2);
            pressureEl.classList.add('pulse');
            setTimeout(() => pressureEl.classList.remove('pulse'), 150);
        }

        const timeEl = cardEl.querySelector('.time-live-val');
        if (timeEl) {
            timeEl.innerText = new Date(timestamp || Date.now()).toLocaleTimeString('pt-BR');
        }

        const r1OnEl = cardEl.querySelector('.r1-on-val');
        if (r1OnEl && rele1_on !== null && rele1_on !== undefined) r1OnEl.innerText = Number(rele1_on).toFixed(1);

        const r1OffEl = cardEl.querySelector('.r1-off-val');
        if (r1OffEl && rele1_off !== null && rele1_off !== undefined) r1OffEl.innerText = Number(rele1_off).toFixed(1);

        const r1AcEl = cardEl.querySelector('.r1-ac-val');
        if (r1AcEl && rele1_acionamentos !== null && rele1_acionamentos !== undefined) r1AcEl.innerText = rele1_acionamentos;
    }

    // 3. Se o gráfico ativo for deste dispositivo, faz o streaming instantâneo
    const select = document.getElementById('releDeviceSelect');
    if (select && select.value === numeroSerie && historyChartInstance) {
        const nowLabel = new Date(timestamp || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        historyChartInstance.data.labels.push(nowLabel);
        historyChartInstance.data.datasets[0].data.push(sensor1 !== null && sensor1 !== undefined ? Number(sensor1) : null);
        historyChartInstance.data.datasets[1].data.push(rele1_on !== null && rele1_on !== undefined ? Number(rele1_on) : null);
        historyChartInstance.data.datasets[2].data.push(rele1_off !== null && rele1_off !== undefined ? Number(rele1_off) : null);
        historyChartInstance.data.datasets[3].data.push(rele2_on !== null && rele2_on !== undefined ? Number(rele2_on) : null);
        historyChartInstance.data.datasets[4].data.push(rele2_off !== null && rele2_off !== undefined ? Number(rele2_off) : null);

        // Mantém janela deslizante de 20 pontos para visualização ágil e contínua
        if (historyChartInstance.data.labels.length > 20) {
            historyChartInstance.data.labels.shift();
            historyChartInstance.data.datasets.forEach(ds => ds.data.shift());
        }

        // Renderiza com transição suave e ultrarrápida
        historyChartInstance.update();
    }

    // 4. Se o modal estiver aberto para este dispositivo, atualiza os campos
    const modal = document.getElementById('sensorModal');
    if (modal && modal.classList.contains('active')) {
        const title = document.getElementById('modalSensorTitle')?.innerText || '';
        if (title.includes(numeroSerie) && dev) {
            updateModalLiveValues(dev);
        }
    }
}

/**
 * Carrega todos os dados do dashboard de relés
 */
async function loadDashboardData(silent = false) {
    if (isUpdatingDashboard) return;
    isUpdatingDashboard = true;

    try {
        await Promise.all([
            fetchDevicesFromApi(),
            fetchAlertsFromApi()
        ]);
    } catch (err) {
        if (!silent) console.error('[Dashboard] Erro ao carregar dados:', err);
    } finally {
        isUpdatingDashboard = false;
    }
}

/**
 * Busca a lista de relés e suas últimas leituras
 */
async function fetchDevicesFromApi() {
    try {
        const res = await fetch(`${API_BASE}/api/reles`);
        if (!res.ok) throw new Error('Falha ao conectar com a API de relés.');
        const result = await res.json();

        if (result.success && Array.isArray(result.data)) {
            currentDevices = result.data;
            renderSensorCards(currentDevices);
            updateDashboardSummary(currentDevices);
            populateDeviceSelect(currentDevices);

            // Atualiza o gráfico se houver dispositivo selecionado
            const select = document.getElementById('releDeviceSelect');
            if (select && select.value) {
                loadAndRenderHistoryChart(select.value, false);
            }

            // Atualiza modal se estiver aberto
            const modal = document.getElementById('sensorModal');
            if (modal && modal.classList.contains('active')) {
                const title = document.getElementById('modalSensorTitle')?.innerText || '';
                const openDev = currentDevices.find(d => title.includes(d.numero_serie));
                if (openDev) {
                    updateModalLiveValues(openDev);
                }
            }
        }
    } catch (err) {
        console.warn('[Relés] Erro ao buscar relés:', err.message);
    }
}

/**
 * Renderiza os cards dos relés com dados ao vivo
 */
function renderSensorCards(devices) {
    const container = document.getElementById('sensorListContainer');
    if (!container) return;

    if (devices.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: #888;">Nenhum relé cadastrado ou com leituras no momento.</div>`;
        lastDevicesSignature = '';
        return;
    }

    // Cria assinatura dos dados dos dispositivos para evitar redesenho inútil
    const newSignature = JSON.stringify(devices.map(d => ({
        s: d.numero_serie,
        st: d.status,
        ts: d.ultima_leitura?.timestamp,
        s1: d.ultima_leitura?.sensor1,
        r1_on: d.ultima_leitura?.rele1_on,
        r1_off: d.ultima_leitura?.rele1_off,
        r1_ac: d.ultima_leitura?.rele1_acionamentos,
        r2_on: d.ultima_leitura?.rele2_on,
        r2_off: d.ultima_leitura?.rele2_off,
        r2_ac: d.ultima_leitura?.rele2_acionamentos
    })));

    if (lastDevicesSignature === newSignature) {
        return; // Nada mudou nos cards, não reconstrói o DOM
    }
    lastDevicesSignature = newSignature;

    const cardsHtml = devices.map(dev => {
        const l = dev.ultima_leitura || {};
        const isAlert = dev.status !== 'Operacional';
        
        const sensor1 = l.sensor1 !== null && l.sensor1 !== undefined ? Number(l.sensor1).toFixed(2) : '--';
        const rele1_on = l.rele1_on !== null && l.rele1_on !== undefined ? Number(l.rele1_on).toFixed(1) : '--';
        const rele1_off = l.rele1_off !== null && l.rele1_off !== undefined ? Number(l.rele1_off).toFixed(1) : '--';
        const rele1_acionamentos = l.rele1_acionamentos !== null && l.rele1_acionamentos !== undefined ? l.rele1_acionamentos : '--';

        const rele2_on = l.rele2_on !== null && l.rele2_on !== undefined ? Number(l.rele2_on).toFixed(1) : '--';
        const rele2_off = l.rele2_off !== null && l.rele2_off !== undefined ? Number(l.rele2_off).toFixed(1) : '--';
        const rele2_acionamentos = l.rele2_acionamentos !== null && l.rele2_acionamentos !== undefined ? l.rele2_acionamentos : '--';

        const dotClass = dev.status === 'Crítico' ? 'red' : (dev.status === 'Atenção' ? 'yellow' : 'green');
        const statusText = dev.status || 'Operacional';
        const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleTimeString('pt-BR') : 'Sem leitura';

        return `
            <div class="sensor-card ${isAlert ? 'alert' : ''}" data-serie="${dev.numero_serie}" onclick="openDeviceDetailModal('${dev.numero_serie}')">
                <div class="sensor-header">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <h4>Relé ${dev.numero_serie}</h4>
                        <span class="status-dot ${dotClass}" title="Status: ${statusText}"></span>
                    </div>
                    <span class="time-live-val" style="font-size: 10px; color: #94a3b8;">${timeStr}</span>
                </div>
                <div class="sensor-body">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; background: #f8fafc; padding: 6px 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
                        <span style="font-size: 11px; color: #475569; font-weight: 500;">Pressão (Sensor 1):</span>
                        <strong class="pressure-live-val metric-live-val" style="font-size: 14px; color: #0284c7;">${sensor1}</strong>
                    </div>
                    <div style="font-size: 11px; color: #334155; line-height: 1.6;">
                        <p style="margin: 2px 0;"><strong>R1:</strong> ON: <span class="val-display r1-on-val">${rele1_on}</span> | OFF: <span class="val-display r1-off-val">${rele1_off}</span> | Acionamentos: <strong class="r1-ac-val">${rele1_acionamentos}</strong></p>
                        <p style="margin: 2px 0;"><strong>R2:</strong> ON: <span class="val-display r2-on-val">${rele2_on}</span> | OFF: <span class="val-display r2-off-val">${rele2_off}</span> | Acionamentos: <strong class="r2-ac-val">${rele2_acionamentos}</strong></p>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = cardsHtml;
}

/**
 * Atualiza o sumário do dashboard
 */
function updateDashboardSummary(devices) {
    const cardStatusGeral = document.getElementById('cardStatusGeral');
    const cardStatusGeralSub = document.getElementById('cardStatusGeralSub');
    const cardCountAtencao = document.getElementById('cardCountAtencao');

    let countAtencao = 0;
    let countCritico = 0;

    devices.forEach(d => {
        if (d.status === 'Atenção') countAtencao++;
        if (d.status === 'Crítico') countCritico++;
    });

    if (cardCountAtencao) {
        cardCountAtencao.innerText = countAtencao + countCritico;
    }

    if (cardStatusGeral) {
        if (countCritico > 0) {
            cardStatusGeral.innerText = 'Crítico';
            cardStatusGeral.style.color = '#dc2626';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = `${countCritico} relé(s) em estado crítico!`;
        } else if (countAtencao > 0) {
            cardStatusGeral.innerText = 'Atenção';
            cardStatusGeral.style.color = '#f59e0b';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = `${countAtencao} relé(s) em atenção`;
        } else {
            cardStatusGeral.innerText = 'Normal';
            cardStatusGeral.style.color = '#10b981';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = 'Todos os relés operacionais';
        }
    }
}

/**
 * Preenche o select de dispositivos sem perder a seleção atual
 */
function populateDeviceSelect(devices) {
    const select = document.getElementById('releDeviceSelect');
    if (!select) return;
    
    const currentValue = select.value;
    const existingOptions = Array.from(select.options).map(o => o.value).filter(v => v !== "");
    const newSerials = devices.map(d => d.numero_serie);

    // Se as opções forem as mesmas, não recria o DOM do select para não atrapalhar o usuário
    const isSame = existingOptions.length === newSerials.length && existingOptions.every((v, i) => v === newSerials[i]);
    
    if (!isSame) {
        select.innerHTML = '<option value="">Selecione um Dispositivo</option>';
        devices.forEach(d => {
            const option = document.createElement('option');
            option.value = d.numero_serie;
            option.textContent = `Relé ${d.numero_serie}`;
            select.appendChild(option);
        });

        if (currentValue && devices.some(d => d.numero_serie === currentValue)) {
            select.value = currentValue;
        } else if (devices.length > 0) {
            select.value = devices[0].numero_serie;
        }
    } else if (!currentValue && devices.length > 0) {
        select.value = devices[0].numero_serie;
    }
}

/**
 * Busca histórico do dispositivo e renderiza o gráfico com animação fluida
 */
async function loadAndRenderHistoryChart(forcedNumeroSerie = null, forceRedraw = false) {
    const select = document.getElementById('releDeviceSelect');
    const numeroSerie = forcedNumeroSerie || (select ? select.value : null);
    if (!numeroSerie) return;
    
    const periodSelect = document.getElementById('chartHistoryPeriod');
    const periodo = periodSelect ? periodSelect.value : 'all';
    
    try {
        const res = await fetch(`${API_BASE}/api/reles/${numeroSerie}/leituras?periodo=${periodo}`);
        if (!res.ok) throw new Error('Erro ao buscar dados do gráfico.');
        const result = await res.json();
        
        if (result.success && Array.isArray(result.data)) {
            // Reverte para ordem cronológica (do mais antigo para o mais recente)
            let chronologicalData = result.data.slice().reverse();
            
            // Para visual de streaming contínuo ("correndo"), exibe os últimos 20 pontos na visualização padrão
            if (periodo === 'all' && chronologicalData.length > 20) {
                chronologicalData = chronologicalData.slice(-20);
            }
            
            renderHistoryChart(chronologicalData, numeroSerie, periodo, forceRedraw);
        }
    } catch (err) {
        console.error('Erro ao carregar dados do gráfico:', err);
    }
}

/**
 * Renderiza o gráfico de relés com animações suaves e contínuas
 */
function renderHistoryChart(data, numeroSerie = '', periodo = '', forceRedraw = false) {
    const ctx = document.getElementById('historyChart');
    if (!ctx) return;

    // Assinatura dos dados para detectar novidades
    const currentSignature = `${numeroSerie}_${periodo}_` + data.map(d => `${d.id || ''}_${d.sensor1}_${d.rele1_on}_${d.rele1_off}_${d.timestamp_leitura || d.created_at}`).join('|');

    if (!forceRedraw && lastChartSignature === currentSignature && historyChartInstance) {
        return;
    }
    lastChartSignature = currentSignature;
    
    const labels = data.map(d => {
        const t = d.timestamp_leitura || d.created_at;
        return t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    });
    
    const sensor1 = data.map(d => d.sensor1 !== null ? Number(d.sensor1) : null);
    const r1On = data.map(d => d.rele1_on !== null ? Number(d.rele1_on) : null);
    const r1Off = data.map(d => d.rele1_off !== null ? Number(d.rele1_off) : null);
    const r2On = data.map(d => d.rele2_on !== null ? Number(d.rele2_on) : null);
    const r2Off = data.map(d => d.rele2_off !== null ? Number(d.rele2_off) : null);
    
    if (historyChartInstance) {
        historyChartInstance.data.labels = labels;
        historyChartInstance.data.datasets[0].data = sensor1;
        historyChartInstance.data.datasets[1].data = r1On;
        historyChartInstance.data.datasets[2].data = r1Off;
        historyChartInstance.data.datasets[3].data = r2On;
        historyChartInstance.data.datasets[4].data = r2Off;
        
        // Atualiza com animação suave e ultrarrápida
        historyChartInstance.update(); 
        return;
    }
    
    historyChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Pressão (Sensor 1)',
                    data: sensor1,
                    borderColor: '#0ea5e9', // Sky Blue
                    backgroundColor: 'rgba(14, 165, 233, 0.12)',
                    borderWidth: 2.5,
                    borderDash: [], // Linha 100% sólida e contínua
                    pointRadius: 0, // Sem pontos para suavidade total
                    pointHoverRadius: 6,
                    pointHitRadius: 10,
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
                    label: 'Relé 1 ON (Setpoint)',
                    data: r1On,
                    borderColor: '#10b981', // Verde Esmeralda
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [], // Linha 100% sólida e contínua
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHitRadius: 10,
                    tension: 0.25,
                    borderCapStyle: 'round',
                    borderJoinStyle: 'round',
                    spanGaps: true,
                    fill: false,
                    normalized: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Relé 1 OFF (Setpoint)',
                    data: r1Off,
                    borderColor: '#ef4444', // Vermelho
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [], // Linha 100% sólida e contínua
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHitRadius: 10,
                    tension: 0.25,
                    borderCapStyle: 'round',
                    borderJoinStyle: 'round',
                    spanGaps: true,
                    fill: false,
                    normalized: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Relé 2 ON',
                    data: r2On,
                    borderColor: '#8b5cf6', // Roxo / Indigo
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [], // Linha 100% sólida e contínua
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHitRadius: 10,
                    tension: 0.25,
                    borderCapStyle: 'round',
                    borderJoinStyle: 'round',
                    spanGaps: true,
                    fill: false,
                    hidden: true,
                    normalized: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Relé 2 OFF',
                    data: r2Off,
                    borderColor: '#f43f5e', // Rosa / Coral
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [], // Linha 100% sólida e contínua
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHitRadius: 10,
                    tension: 0.25,
                    borderCapStyle: 'round',
                    borderJoinStyle: 'round',
                    spanGaps: true,
                    fill: false,
                    hidden: true,
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
                    position: 'top',
                    labels: {
                        color: '#334155',
                        usePointStyle: true,
                        boxWidth: 8,
                        padding: 14,
                        font: {
                            size: 11,
                            family: 'Inter, sans-serif'
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f8fafc',
                    bodyColor: '#cbd5e1',
                    borderColor: '#334155',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y !== null ? context.parsed.y : '--'}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b', maxTicksLimit: 6, font: { size: 10 } }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grace: '10%',
                    grid: { color: 'rgba(226, 232, 240, 0.5)', drawBorder: false },
                    ticks: { color: '#64748b', maxTicksLimit: 7, font: { size: 10 } }
                }
            }
        }
    });
}

/**
 * Abre o modal de detalhes do relé
 */
function openDeviceDetailModal(numeroSerie) {
    const dev = currentDevices.find(d => d.numero_serie === numeroSerie);
    if (!dev) return;

    const modal = document.getElementById('sensorModal');
    document.getElementById('modalSensorTitle').innerText = `Relé: ${dev.numero_serie}`;
    document.getElementById('modalLocationText').innerText = `Número de Série: ${dev.numero_serie}`;
    
    const historyPeriodSelect = document.getElementById('modalHistoryPeriod');
    if (historyPeriodSelect) {
        historyPeriodSelect.dataset.device = dev.numero_serie;
        historyPeriodSelect.value = 'all';
    }

    updateModalLiveValues(dev);
    fetchDeviceHistory(numeroSerie);

    modal.classList.add('active');

    const coords = numeroSerie.includes('SP') ? [-23.5505, -46.6333] : [-22.9068, -43.1729];
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

/**
 * Atualiza valores ao vivo no modal
 */
function updateModalLiveValues(dev) {
    const l = dev.ultima_leitura || {};
    const timestampStr = l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR') : 'Sem registros de leitura';
    const lastTimeEl = document.getElementById('modalLastTimestamp');
    if (lastTimeEl) lastTimeEl.innerText = `Última Leitura: ${timestampStr}`;

    const devStatus = document.getElementById('modalDeviceStatus');
    if (devStatus) devStatus.innerText = `Status Geral: ${dev.status || 'Operacional'}`;

    const dotClass = dev.status === 'Crítico' ? '#dc2626' : (dev.status === 'Atenção' ? '#f59e0b' : '#10b981');
    const dot = document.getElementById('modalLedDot');
    if (dot) dot.style.background = dotClass;
    
    const ledText = document.getElementById('modalLedText');
    if (ledText) ledText.innerText = `Status: ${dev.status || 'Operacional'}`;

    const grid = document.getElementById('modalParamsGrid');
    if (grid) {
        grid.innerHTML = `
            ${renderParamCard('Pressão (Sensor 1)', l.sensor1 !== null && l.sensor1 !== undefined ? Number(l.sensor1).toFixed(2) : null, '', '', false)}
            ${renderParamCard('Relé 1 ON', l.rele1_on !== null && l.rele1_on !== undefined ? Number(l.rele1_on).toFixed(1) : null, '', '', false)}
            ${renderParamCard('Relé 1 OFF', l.rele1_off !== null && l.rele1_off !== undefined ? Number(l.rele1_off).toFixed(1) : null, '', '', false)}
            ${renderParamCard('Acionamentos R1', l.rele1_acionamentos, '', '', false)}
            ${renderParamCard('Relé 2 ON', l.rele2_on !== null && l.rele2_on !== undefined ? Number(l.rele2_on).toFixed(1) : null, '', '', false)}
            ${renderParamCard('Relé 2 OFF', l.rele2_off !== null && l.rele2_off !== undefined ? Number(l.rele2_off).toFixed(1) : null, '', '', false)}
            ${renderParamCard('Acionamentos R2', l.rele2_acionamentos, '', '', false)}
        `;
    }
}

/**
 * Busca histórico detalhado para a lista do modal
 */
async function fetchDeviceHistory(numeroSerie, periodo = 'all') {
    const historyContainer = document.getElementById('modalHistoryContainer');
    if (!historyContainer) return;

    try {
        const res = await fetch(`${API_BASE}/api/reles/${numeroSerie}/leituras?periodo=${periodo}`);
        if (!res.ok) throw new Error('Erro ao buscar histórico de leituras.');
        const result = await res.json();

        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
            historyContainer.innerHTML = result.data.map(item => {
                const time = item.timestamp_leitura ? new Date(item.timestamp_leitura).toLocaleString('pt-BR') : (item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : 'N/A');
                const s1 = item.sensor1 !== null ? Number(item.sensor1).toFixed(2) : '--';
                const r1On = item.rele1_on !== null ? Number(item.rele1_on).toFixed(1) : '--';
                const r1Off = item.rele1_off !== null ? Number(item.rele1_off).toFixed(1) : '--';
                const r1Ac = item.rele1_acionamentos !== null ? item.rele1_acionamentos : '--';

                return `
                    <div style="padding: 8px 0; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 11px;">
                        <div>
                            <span style="color: #10b981; font-weight: bold; margin-right: 4px;">●</span> 
                            <span style="color: #94a3b8;">${time}</span>
                        </div>
                        <div style="text-align: right; color: #e2e8f0;">
                            Sensor 1: <strong style="color: #38bdf8;">${s1}</strong> | 
                            R1 ON: <strong>${r1On}</strong> | 
                            R1 OFF: <strong>${r1Off}</strong> | 
                            Acionamentos: <strong>${r1Ac}</strong>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            historyContainer.innerHTML = `<div style="color: #94a3b8; padding: 15px; text-align: center;">Nenhum registro histórico encontrado para este período.</div>`;
        }
    } catch (err) {
        historyContainer.innerHTML = `<div style="color: #ef4444; padding: 15px; text-align: center;">Erro ao carregar histórico da API.</div>`;
    }
}

function renderParamCard(label, val, unit, rangeStr, isOut) {
    const displayVal = val !== null && val !== undefined ? `${val}${unit}` : '--';
    const cardClass = isOut ? 'param-card-mini warning' : 'param-card-mini';
    return `
        <div class="${cardClass}">
            <span class="param-label">${label}</span>
            <span class="param-val" style="${isOut ? 'color:#dc2626;' : ''}">${displayVal}</span>
            <span class="param-range-sub">${rangeStr ? 'Ideal: ' + rangeStr : ''}</span>
        </div>
    `;
}

function closeSensorModal() {
    const modal = document.getElementById('sensorModal');
    if (modal) modal.classList.remove('active');
}

/**
 * Alertas e Avisos
 */
async function fetchAlertsFromApi() {
    try {
        const res = await fetch(`${API_BASE}/api/alertas?unreadOnly=true`);
        if (!res.ok) throw new Error('Falha ao buscar alertas.');
        const result = await res.json();

        if (result.success) {
            currentAlerts = result.data || [];
            updateHeaderAlertBadge(result.summary ? result.summary.unread : currentAlerts.length);
            renderAlertsList();

            const cardCountAlertas = document.getElementById('cardCountAlertas');
            if (cardCountAlertas) cardCountAlertas.innerText = result.summary ? result.summary.unread : currentAlerts.length;
        }
    } catch (err) {
        console.warn('[Alertas] Erro ao carregar alertas:', err.message);
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
        filtered = currentAlerts.filter(a => a.nivel === 'Critico');
    } else if (activeAlertFilter === 'Aviso') {
        filtered = currentAlerts.filter(a => a.nivel === 'Aviso');
    }

    if (filtered.length === 0) {
        list.innerHTML = `<div class="alerts-empty">Nenhum aviso ou alerta pendente no momento.</div>`;
        return;
    }

    list.innerHTML = filtered.map(a => {
        const isCrit = a.nivel === 'Critico';
        const dateStr = a.created_at ? new Date(a.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        
        return `
            <div class="alert-item-card ${isCrit ? 'critico' : ''}">
                <div class="alert-item-header">
                    <span class="alert-device-name">Dispositivo: ${a.dispositivo_numero_serie}</span>
                    <span class="alert-badge-pill ${isCrit ? 'critico' : 'aviso'}">${a.nivel}</span>
                </div>
                <div class="alert-msg-text"><strong>${a.parametro}:</strong> ${a.mensagem}</div>
                <div class="alert-item-footer">
                    <span>${dateStr}</span>
                    <button class="btn-read-alert" onclick="markAlertAsRead(${a.id})">Marcar Lido</button>
                </div>
            </div>
        `;
    }).join('');
}

async function markAlertAsRead(alertId) {
    try {
        const res = await fetch(`${API_BASE}/api/alertas/${alertId}/lido`, { method: 'PUT' });
        if (res.ok) fetchAlertsFromApi();
    } catch (e) {}
}

async function markAllAlertsAsRead() {
    try {
        const res = await fetch(`${API_BASE}/api/alertas/limpar-todos`, { method: 'PUT' });
        if (res.ok) fetchAlertsFromApi();
    } catch (e) {}
}

