let mapInstance = null;
let currentDevices = [];
let currentAlerts = [];
let activeAlertFilter = 'todos';
let volumeChartInstance = null;
let tempChartInstance = null;

// Usa window.API_BASE definido globalmente em config.js

document.addEventListener('DOMContentLoaded', function() {
    // 1. Carregar Sensores e Alertas da API
    loadDashboardData();

    // Conectar via Socket.IO para atualizações em tempo real
    if (typeof io !== 'undefined') {
        const socket = io(API_BASE);
        socket.on('dashboard_update', (data) => {
            console.log('Recebido update via WebSocket:', data);
            loadDashboardData();
            
            // Se o modal do dispositivo atualizado estiver aberto, atualiza o histórico também
            const modal = document.getElementById('sensorModal');
            if (modal && modal.classList.contains('active')) {
                const title = document.getElementById('modalSensorTitle').innerText;
                if (title.includes(data.numeroSerie)) {
                    fetchDeviceHistory(data.numeroSerie);
                }
            }
        });
    } else {
        console.warn('Socket.IO não carregado. Fazendo fallback para polling.');
        setInterval(loadDashboardData, 10000);
    }

    // Fechar popover de alertas se clicar fora
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

// ----------------------------------------------------
// 1. DISPOSITIVOS E LEITURAS DA API (banco.sql)
// ----------------------------------------------------
async function fetchDevicesFromApi() {
    try {
        const res = await fetch(`${API_BASE}/api/sensores`);
        if (!res.ok) throw new Error('Falha ao conectar com a API de sensores.');
        const result = await res.json();

        if (result.success && Array.isArray(result.data)) {
            currentDevices = result.data;
            renderSensorCards(currentDevices);
            updateDashboardSummary(currentDevices);
            renderCharts(currentDevices);
        }
    } catch (err) {
        console.warn('[Sensores] Erro ao carregar sensores:', err.message);
    }
}

function renderSensorCards(devices) {
    const container = document.getElementById('sensorListContainer');
    if (!container) return;

    if (devices.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: #888;">Nenhum dispositivo cadastrado no banco de dados.</div>`;
        return;
    }

    container.innerHTML = devices.map(dev => {
        const l = dev.ultima_leitura || {};
        const led = dev.led || 'Verde';
        const isAlert = led === 'Amarelo' || led === 'Vermelho' || dev.status !== 'Operacional';
        
        const tempText = l.temperatura !== null && l.temperatura !== undefined ? `${l.temperatura}°C` : '--';
        const umidText = l.umidade !== null && l.umidade !== undefined ? `${l.umidade}%` : '--';
        const co2Text = l.co2 !== null && l.co2 !== undefined ? `${l.co2} ppm` : '--';

        const dotClass = led === 'Vermelho' ? 'red' : (led === 'Amarelo' ? 'yellow' : 'green');
        const statusText = dev.status || 'Operacional';

        return `
            <div class="sensor-card ${isAlert ? 'alert' : ''}" onclick="openDeviceDetailModal('${dev.numero_serie}')">
                <div class="sensor-header">
                    <h4>Transmissor ${dev.numero_serie}</h4>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="status-dot ${dotClass}" title="LED: ${led}"></span>
                    </div>
                </div>
                <div class="sensor-body">
                    <p><strong>Status:</strong> ${statusText}</p>
                    <p><strong>Temp:</strong> <span class="val-display">${tempText}</span> | <strong>Umid:</strong> ${umidText}</p>
                    <p><strong>CO2:</strong> ${co2Text}</p>
                    <p class="tolerance-badge">Ideal Temp: 18°C a 26°C</p>
                </div>
            </div>
        `;
    }).join('');
}

function updateDashboardSummary(devices) {
    const cardStatusGeral = document.getElementById('cardStatusGeral');
    const cardStatusGeralSub = document.getElementById('cardStatusGeralSub');
    const cardCountAtencao = document.getElementById('cardCountAtencao');

    let countAtencao = 0;
    let countCritico = 0;

    devices.forEach(d => {
        if (d.led === 'Amarelo' || d.status === 'Atenção') countAtencao++;
        if (d.led === 'Vermelho' || d.status === 'Crítico') countCritico++;
    });

    if (cardCountAtencao) cardCountAtencao.innerText = countAtencao + countCritico;

    if (cardStatusGeral) {
        if (countCritico > 0) {
            cardStatusGeral.innerText = 'Crítico';
            cardStatusGeral.style.color = '#dc2626';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = `${countCritico} dispositivo(s) em estado crítico!`;
        } else if (countAtencao > 0) {
            cardStatusGeral.innerText = 'Atenção';
            cardStatusGeral.style.color = '#f59e0b';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = `${countAtencao} dispositivo(s) fora da faixa ideal`;
        } else {
            cardStatusGeral.innerText = 'Normal';
            cardStatusGeral.style.color = '#10b981';
            if (cardStatusGeralSub) cardStatusGeralSub.innerText = 'Todos os parâmetros dentro do range';
        }
    }
}

// ----------------------------------------------------
// 2. CENTRAL DE AVISOS E ALERTAS NO HEADER
// ----------------------------------------------------
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
        if (res.ok) {
            fetchAlertsFromApi();
        }
    } catch (e) {
        console.error('Erro ao marcar alerta como lido:', e);
    }
}

async function markAllAlertsAsRead() {
    try {
        const res = await fetch(`${API_BASE}/api/alertas/limpar-todos`, { method: 'PUT' });
        if (res.ok) {
            fetchAlertsFromApi();
        }
    } catch (e) {
        console.error('Erro ao limpar alertas:', e);
    }
}

// ----------------------------------------------------
// 3. MODAL DE DETALHES DO DISPOSITIVO
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
        dot.style.background = led === 'Vermelho' ? '#dc2626' : (led === 'Amarelo' ? '#f59e0b' : '#10b981');
    }
    if (ledText) ledText.innerText = `LED Indicador: ${led}`;
    if (devStatus) devStatus.innerText = `Status Geral: ${dev.status || 'Operacional'}`;

    // Render dos 7 Parâmetros
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

    // Busca histórico de leituras via rota GET /api/sensores/:numeroSerie/leituras
    fetchDeviceHistory(numeroSerie);

    modal.classList.add('active');

    // Inicializar mapa Leaflet simulando coordenadas
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

    historyContainer.innerHTML = `<div style="color: #94a3b8;">Carregando histórico do banco de dados...</div>`;

    try {
        const res = await fetch(`${API_BASE}/api/sensores/${numeroSerie}/leituras`);
        if (!res.ok) throw new Error('Erro ao buscar histórico de leituras.');
        const result = await res.json();

        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
            historyContainer.innerHTML = result.data.map(item => {
                const time = item.timestamp_leitura ? new Date(item.timestamp_leitura).toLocaleString('pt-BR') : (item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : 'N/A');
                const ledColor = item.led === 'Vermelho' ? '#ef4444' : (item.led === 'Amarelo' ? '#f59e0b' : '#10b981');
                return `
                    <div style="padding: 6px 0; border-bottom: 1px dashed #334155; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                        <div>
                            <span style="color: ${ledColor}; font-weight: bold;">● [${item.led || 'Verde'}]</span> 
                            <span style="color: #94a3b8;">${time}</span>
                        </div>
                        <div style="text-align: right; color: #e2e8f0;">
                            Temp: <strong>${item.temperatura !== null ? item.temperatura + '°C' : '--'}</strong> | 
                            Umid: <strong>${item.umidade !== null ? item.umidade + '%' : '--'}</strong> | 
                            CO2: <strong>${item.co2 !== null ? item.co2 + ' ppm' : '--'}</strong>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            historyContainer.innerHTML = `<div style="color: #94a3b8;">Nenhum registro histórico encontrado.</div>`;
        }
    } catch (err) {
        console.warn('[Sensores] Erro ao carregar histórico:', err.message);
        historyContainer.innerHTML = `<div style="color: #ef4444;">Erro ao carregar histórico da API.</div>`;
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
// 4. MODAL DE LIMITES E RANGES PRESCRITOS
// ----------------------------------------------------
async function openPrescribedRangesModal() {
    const modal = document.getElementById('rangesModal');
    const tbody = document.getElementById('rangesTableBody');
    if (!modal || !tbody) return;

    try {
        const res = await fetch(`${API_BASE}/api/limites`);
        if (!res.ok) throw new Error('Erro ao buscar limites');
        const limites = await res.json();
        
        let html = '';
        const order = ['temperatura', 'umidade', 'co2', 'pm25', 'pm10', 'voc', 'formaldeido'];
        order.forEach(key => {
            const l = limites[key];
            if (!l) return;
            
            const hasMin = l.min_ideal !== undefined;
            const inputStyle = 'width: 50px; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 4px; padding: 4px 2px; text-align: center; font-size: 12px; margin: 0 2px;';
            
            html += `
            <tr data-param="${key}">
                <td style="white-space: nowrap;"><strong>${l.label}</strong></td>
                <td>${l.unit}</td>
                <td style="white-space: nowrap;">
                    ${hasMin ? 
                        `<input type="number" step="0.1" class="input-limite" data-field="min_ideal" value="${l.min_ideal}" style="${inputStyle}"> a 
                         <input type="number" step="0.1" class="input-limite" data-field="max_ideal" value="${l.max_ideal}" style="${inputStyle}">` 
                        : 
                        `&le; <input type="number" step="0.1" class="input-limite" data-field="max_ideal" value="${l.max_ideal}" style="${inputStyle}">`
                    }
                </td>
                <td style="color: #f59e0b; white-space: nowrap; font-size: 12px;">
                    ${hasMin ? 
                        `Fora do Ideal` 
                        : 
                        `Até <input type="number" step="0.1" class="input-limite" data-field="max_aviso" value="${l.max_aviso}" style="${inputStyle}">`
                    }
                </td>
                <td style="color: #ef4444; white-space: nowrap; font-size: 12px;">
                    ${hasMin ? 
                        `&lt; <input type="number" step="0.1" class="input-limite" data-field="crit_min" value="${l.crit_min}" style="${inputStyle}"> ou 
                         &gt; <input type="number" step="0.1" class="input-limite" data-field="crit_max" value="${l.crit_max}" style="${inputStyle}">` 
                        : 
                        `&gt; Aviso Max`
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
            novosLimites[param][field] = input.value !== '' ? Number(input.value) : '';
        });
    });
    
    try {
        const res = await fetch(`${API_BASE}/api/limites`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(novosLimites)
        });
        
        if (res.ok) {
            alert('Limites atualizados com sucesso!');
            closeRangesModal();
            loadDashboardData(); // Recarrega para refletir mudanças se aplicável
        } else {
            alert('Erro ao atualizar limites.');
        }
    } catch (e) {
        console.error('Erro ao salvar limites:', e);
        alert('Erro ao conectar com a API.');
    }
}

// ----------------------------------------------------
// 5. RENDER DE GRÁFICOS (Chart.js)
// ----------------------------------------------------
function renderCharts(devices) {
    const labels = devices.map(d => d.numero_serie);
    const temps = devices.map(d => d.ultima_leitura?.temperatura ?? 0);
    const umids = devices.map(d => d.ultima_leitura?.umidade ?? 0);
    const co2s = devices.map(d => (d.ultima_leitura?.co2 ?? 0) / 10); // escala para gráfico

    // 1. Gráfico de Média de Valores (Bar)
    const ctxVol = document.getElementById('volumeChart');
    if (ctxVol) {
        if (volumeChartInstance) volumeChartInstance.destroy();
        volumeChartInstance = new Chart(ctxVol.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Temperatura (°C)', data: temps, backgroundColor: '#10b981' },
                    { label: 'Umidade (%)', data: umids, backgroundColor: '#3b82f6' },
                    { label: 'CO2 (div 10)', data: co2s, backgroundColor: '#f59e0b' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } },
                scales: { y: { suggestedMin: 0 } }
            }
        });
    }

    // 2. Gráfico de Variação com Limite Máximo Prescrito (26°C)
    const ctxTemp = document.getElementById('tempChart');
    if (ctxTemp) {
        if (tempChartInstance) tempChartInstance.destroy();
        tempChartInstance = new Chart(ctxTemp.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Temperatura Lida (°C)',
                        data: temps,
                        borderColor: '#111827',
                        borderWidth: 2,
                        tension: 0.2,
                        pointBackgroundColor: temps.map(t => t > 26 ? '#dc2626' : '#10b981')
                    },
                    {
                        label: 'Limite Prescrito Máximo (26°C)',
                        data: labels.map(() => 26.0),
                        borderColor: '#dc2626',
                        borderDash: [5, 5],
                        borderWidth: 2,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } },
                scales: { y: { suggestedMin: 10, suggestedMax: 35 } }
            }
        });
    }
}

// Fechar modais ao clicar fora
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
