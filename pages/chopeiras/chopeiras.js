let currentChopeiras = [];
let selectedDeviceSerial = '';
let chopeirasChartInstance = null;
let socketInstance = null;
let isUpdatingDashboard = false;
let lastChartSignature = '';
let lastDevicesSignature = '';
let lastProcessedReadingSignature = '';
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

    // Polling ultrarrápido a cada 160ms para captura contínua e fluida de dados atualizados a cada 300ms
    setInterval(() => {
        loadChopeirasData(true);
    }, 160);

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
                    loadChopeirasData(true);
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

function getAuthHeaders() {
    const token = localStorage.getItem('sensorium_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
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
            pressureEl.innerText = `${Number(sensor1).toFixed(2)} bar`;
        }
    }

    // 4. Se o gráfico estiver exibindo esta chopeira, alimenta o motor de telemetria ultra-fluida
    if (selectedDeviceSerial === numeroSerie) {
        const engine = getFluidTelemetryEngine();
        if (engine) {
            engine.pushReading(sensor1, rele1_on, rele1_off, timestamp);
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
    if (r1AcEl) r1AcEl.innerText = reading.rele1_acionamentos ?? '--';
    if (r1StatusEl) {
        const isActive = (reading.rele1_on !== null && reading.sensor1 !== null && reading.sensor1 >= reading.rele1_on);
        r1StatusEl.innerText = isActive ? 'ATIVO (ON)' : 'DESLIGADO (OFF)';
        r1StatusEl.style.color = isActive ? '#10b981' : '#64748b';
    }

    if (r2OnEl) r2OnEl.innerText = reading.rele2_on !== null && reading.rele2_on !== undefined ? Number(reading.rele2_on).toFixed(1) : '--';
    if (r2OffEl) r2OffEl.innerText = reading.rele2_off !== null && reading.rele2_off !== undefined ? Number(reading.rele2_off).toFixed(1) : '--';
    if (r2AcEl) r2AcEl.innerText = reading.rele2_acionamentos ?? '--';
    if (r2StatusEl) {
        const isActive = (reading.rele2_on !== null && reading.sensor1 !== null && reading.sensor1 >= reading.rele2_on);
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
                <div class="chopeira-card ${isSel ? 'selected' : ''}" data-serie="${d.numero_serie}" onclick="selectChopeira('${d.numero_serie}')">
                    <div class="chopeira-card-header">
                        <span class="chopeira-card-title">Chopeira #${d.numero_serie}</span>
                        <span class="status-dot-fine ${dotClass}" title="${d.status || 'Operacional'}"></span>
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
            if (pressEl && pressEl.innerText !== `${press} bar`) {
                pressEl.innerText = `${press} bar`;
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
   MOTOR DE TELEMETRIA CONTÍNUA ULTRA-FLUIDA (60/120 FPS PERMANENTE)
   ========================================================================== */

class FluidTelemetryEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        
        this.numPoints = 60; // 60 amostras cobrindo 100% da largura do canvas
        this.points = new Array(this.numPoints).fill(0);
        
        this.targetPressure = 0;
        this.currentPressure = 0;
        this.setpointOn = null;
        this.setpointOff = null;
        
        this.minVal = 0;
        this.maxVal = 100;
        
        this.isRunning = false;
        this.animFrameId = null;
        this.lastFrameTime = performance.now();
        this.pulsePhase = 0;
        this.sampleTimer = 0;
        this.sampleIntervalMs = 150; // Amostragem contínua fluida a cada 150ms
        
        this.mouseX = -1;
        this.mouseY = -1;
        this.isHovering = false;
        
        this.setupCanvas();
        this.setupEvents();
        this.start();
    }
    
    setupCanvas() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.width = rect.width || 800;
        this.height = rect.height || 340;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.ctx.scale(dpr, dpr);
    }
    
    setupEvents() {
        if (!this.canvas) return;
        
        window.addEventListener('resize', () => {
            this.setupCanvas();
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouseX = e.clientX - rect.left;
            this.mouseY = e.clientY - rect.top;
            this.isHovering = true;
        });
        
        this.canvas.addEventListener('mouseleave', () => {
            this.isHovering = false;
        });
    }
    
    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastFrameTime = performance.now();
        const loop = (now) => {
            if (!this.isRunning) return;
            const dt = Math.min(100, now - this.lastFrameTime);
            this.lastFrameTime = now;
            
            this.update(dt);
            this.render(now);
            
            this.animFrameId = requestAnimationFrame(loop);
        };
        this.animFrameId = requestAnimationFrame(loop);
    }
    
    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }
    
    pushReading(sensor1, rele1_on, rele1_off, timestamp = null) {
        const val = sensor1 !== null && sensor1 !== undefined ? Number(sensor1) : null;
        if (val !== null && !isNaN(val)) {
            this.targetPressure = val;
        }
        
        if (rele1_on !== null && rele1_on !== undefined) this.setpointOn = Number(rele1_on);
        if (rele1_off !== null && rele1_off !== undefined) this.setpointOff = Number(rele1_off);
    }
    
    loadHistory(data, serial) {
        // Identifica setpoints
        let spOn = null;
        let spOff = null;
        for (let i = data.length - 1; i >= 0; i--) {
            if (spOn === null && data[i].rele1_on !== null && data[i].rele1_on !== undefined) spOn = Number(data[i].rele1_on);
            if (spOff === null && data[i].rele1_off !== null && data[i].rele1_off !== undefined) spOff = Number(data[i].rele1_off);
        }
        if (spOn !== null) this.setpointOn = spOn;
        if (spOff !== null) this.setpointOff = spOff;
        
        const validValues = data.map(d => (d.sensor1 !== null && d.sensor1 !== undefined ? Number(d.sensor1) : null)).filter(v => v !== null && !isNaN(v));
        
        if (validValues.length > 0) {
            const lastVal = validValues[validValues.length - 1];
            this.targetPressure = lastVal;
            this.currentPressure = lastVal;
            
            // Popula todo o buffer de 60 pontos
            this.points = [];
            for (let i = 0; i < this.numPoints; i++) {
                const ratio = i / (this.numPoints - 1);
                const dataIdx = Math.floor(ratio * (validValues.length - 1));
                this.points.push(validValues[dataIdx] !== undefined ? validValues[dataIdx] : lastVal);
            }
        }
    }
    
    update(dt) {
        // Interpolação suave e orgânica de fluido (60-120 FPS)
        const lerpSpeed = 0.20;
        this.currentPressure += (this.targetPressure - this.currentPressure) * lerpSpeed;
        this.pulsePhase += dt * 0.005;
        
        // Auto-alimentação contínua da esteira de dados
        this.sampleTimer += dt;
        if (this.sampleTimer >= this.sampleIntervalMs) {
            this.sampleTimer = 0;
            this.points.push(this.currentPressure);
            if (this.points.length > this.numPoints) {
                this.points.shift();
            }
        }
    }
    
    getY(val, padTop, plotHeight) {
        const clamped = Math.max(this.minVal, Math.min(this.maxVal, val));
        const ratio = (clamped - this.minVal) / (this.maxVal - this.minVal);
        return padTop + plotHeight * (1 - ratio);
    }
    
    render(now) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        if (!ctx || w <= 0 || h <= 0) return;
        
        ctx.clearRect(0, 0, w, h);
        
        const padTop = 22;
        const padBottom = 32;
        const padLeft = 60;
        const padRight = 85;
        const plotWidth = w - padLeft - padRight;
        const plotHeight = h - padTop - padBottom;
        
        // 1. Grid e Escala 0 a 100 bar
        ctx.lineWidth = 1;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = '500 11px Inter, sans-serif';
        
        const steps = [0, 20, 40, 60, 80, 100];
        steps.forEach(step => {
            const y = this.getY(step, padTop, plotHeight);
            
            // Linha de grade sutil
            ctx.beginPath();
            ctx.strokeStyle = step === 0 ? 'rgba(203, 213, 225, 0.8)' : 'rgba(226, 232, 240, 0.6)';
            ctx.setLineDash([]);
            ctx.moveTo(padLeft, y);
            ctx.lineTo(w - padRight, y);
            ctx.stroke();
            
            // Marcador numérico do eixo Y
            ctx.fillStyle = '#64748b';
            ctx.fillText(`${step} bar`, padLeft - 10, y);
        });
        
        // 2. Linha Fixa de Setpoint ON (Verde Esmeralda)
        if (this.setpointOn !== null && !isNaN(this.setpointOn)) {
            const yOn = this.getY(this.setpointOn, padTop, plotHeight);
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([5, 5]);
            ctx.moveTo(padLeft, yOn);
            ctx.lineTo(w - padRight, yOn);
            ctx.stroke();
            
            // Badge / Pill de Setpoint ON
            ctx.setLineDash([]);
            ctx.fillStyle = '#ecfdf5';
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1;
            const badgeW = 72;
            const badgeH = 20;
            const badgeX = w - padRight + 6;
            const badgeY = yOn - badgeH / 2;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            ctx.fill();
            ctx.stroke();
            
            ctx.fillStyle = '#059669';
            ctx.font = '600 10.5px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`ON: ${this.setpointOn.toFixed(1)}`, badgeX + badgeW / 2, yOn);
            ctx.restore();
        }
        
        // 3. Linha Fixa de Setpoint OFF (Vermelho Coral)
        if (this.setpointOff !== null && !isNaN(this.setpointOff)) {
            const yOff = this.getY(this.setpointOff, padTop, plotHeight);
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([5, 5]);
            ctx.moveTo(padLeft, yOff);
            ctx.lineTo(w - padRight, yOff);
            ctx.stroke();
            
            // Badge / Pill de Setpoint OFF
            ctx.setLineDash([]);
            ctx.fillStyle = '#fef2f2';
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1;
            const badgeW = 72;
            const badgeH = 20;
            const badgeX = w - padRight + 6;
            const badgeY = yOff - badgeH / 2;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            ctx.fill();
            ctx.stroke();
            
            ctx.fillStyle = '#dc2626';
            ctx.font = '600 10.5px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`OFF: ${this.setpointOff.toFixed(1)}`, badgeX + badgeW / 2, yOff);
            ctx.restore();
        }
        
        // 4. Curva de Pressão Contínua (60 pontos distribuídos em 100% do gráfico)
        const renderPoints = [];
        const count = this.points.length;
        
        for (let i = 0; i < count; i++) {
            const x = padLeft + (plotWidth / Math.max(1, count - 1)) * i;
            // Para o último ponto, usa a pressão suavizada em tempo real
            const val = (i === count - 1) ? this.currentPressure : this.points[i];
            const y = this.getY(val, padTop, plotHeight);
            renderPoints.push({ x, y, val });
        }
        
        const leadX = renderPoints[count - 1].x;
        const leadY = renderPoints[count - 1].y;
        
        if (renderPoints.length >= 2) {
            ctx.save();
            
            // Recorte da área de desenho
            ctx.beginPath();
            ctx.rect(padLeft, padTop - 5, plotWidth + 2, plotHeight + 10);
            ctx.clip();
            
            // Constrói Spline Suave (Catmull-Rom / Bezier)
            ctx.beginPath();
            ctx.moveTo(renderPoints[0].x, renderPoints[0].y);
            
            for (let i = 0; i < renderPoints.length - 1; i++) {
                const p0 = renderPoints[Math.max(0, i - 1)];
                const p1 = renderPoints[i];
                const p2 = renderPoints[i + 1];
                const p3 = renderPoints[Math.min(renderPoints.length - 1, i + 2)];
                
                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;
                
                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
            }
            
            // Preenchimento de gradiente translúcido
            const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotHeight);
            grad.addColorStop(0, 'rgba(30, 96, 172, 0.28)');
            grad.addColorStop(0.7, 'rgba(30, 96, 172, 0.05)');
            grad.addColorStop(1, 'rgba(30, 96, 172, 0.0)');
            
            ctx.lineTo(leadX, padTop + plotHeight);
            ctx.lineTo(renderPoints[0].x, padTop + plotHeight);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();
            
            // Traçado da Linha
            ctx.beginPath();
            ctx.moveTo(renderPoints[0].x, renderPoints[0].y);
            for (let i = 0; i < renderPoints.length - 1; i++) {
                const p0 = renderPoints[Math.max(0, i - 1)];
                const p1 = renderPoints[i];
                const p2 = renderPoints[i + 1];
                const p3 = renderPoints[Math.min(renderPoints.length - 1, i + 2)];
                
                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;
                
                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
            }
            
            ctx.shadowColor = 'rgba(30, 96, 172, 0.35)';
            ctx.shadowBlur = 6;
            ctx.strokeStyle = '#1e60ac';
            ctx.lineWidth = 2.8;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
            
            ctx.restore();
        }
        
        // 5. Farol Luminoso na Ponta Ativa em Tempo Real (Live Pulse Beacon)
        ctx.save();
        const waveRadius = 7 + (this.pulsePhase * 8) % 14;
        const waveAlpha = Math.max(0, 1 - waveRadius / 21);
        
        // Onda expansiva
        ctx.beginPath();
        ctx.arc(leadX, leadY, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(30, 96, 172, ${waveAlpha * 0.7})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        // Ponto central
        ctx.beginPath();
        ctx.arc(leadX, leadY, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#1e60ac';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
        
        // 6. Eixo X de Tempo
        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 10.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const timeSteps = 4;
        const totalDurationSec = Math.round((this.numPoints * this.sampleIntervalMs) / 1000);
        for (let i = 0; i <= timeSteps; i++) {
            const x = padLeft + (plotWidth / timeSteps) * i;
            const pastSec = Math.round(((timeSteps - i) / timeSteps) * totalDurationSec);
            const label = pastSec === 0 ? 'Agora' : `-${pastSec}s`;
            ctx.fillText(label, x, padTop + plotHeight + 8);
        }
        
        // 7. Cursor Interativo e Tooltip ao passar o mouse
        if (this.isHovering && this.mouseX >= padLeft && this.mouseX <= w - padRight) {
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.moveTo(this.mouseX, padTop);
            ctx.lineTo(this.mouseX, padTop + plotHeight);
            ctx.stroke();
            
            // Encontra o ponto mais próximo
            let closest = null;
            let minDist = Infinity;
            renderPoints.forEach(p => {
                const dist = Math.abs(p.x - this.mouseX);
                if (dist < minDist) {
                    minDist = dist;
                    closest = p;
                }
            });
            
            if (closest) {
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.arc(closest.x, closest.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#1e60ac';
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();
                
                const ttText = `${Number(closest.val).toFixed(2)} bar`;
                ctx.font = '600 11px Inter, sans-serif';
                const textWidth = ctx.measureText(ttText).width;
                const ttBoxW = textWidth + 18;
                const ttBoxH = 24;
                let ttX = closest.x - ttBoxW / 2;
                let ttY = closest.y - ttBoxH - 8;
                if (ttY < padTop) ttY = closest.y + 10;
                if (ttX < padLeft) ttX = padLeft;
                if (ttX + ttBoxW > w - padRight) ttX = w - padRight - ttBoxW;
                
                ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
                ctx.beginPath();
                ctx.roundRect(ttX, ttY, ttBoxW, ttBoxH, 4);
                ctx.fill();
                
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(ttText, ttX + ttBoxW / 2, ttY + ttBoxH / 2);
            }
            ctx.restore();
        }
    }
}

// Instância única do Motor de Telemetria Fluida
let fluidTelemetry = null;

function getFluidTelemetryEngine() {
    if (!fluidTelemetry) {
        fluidTelemetry = new FluidTelemetryEngine('chopeirasChart');
    }
    return fluidTelemetry;
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

    if (fluidTelemetry) {
        setTimeout(() => fluidTelemetry.setupCanvas(), 100);
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

        // Por padrão, abre o modal mostrando Todos os Dispositivos
        filterDevSelect.value = 'todos';
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
        if (!res.ok) throw new Error('Falha ao consultar registros de relés.');
        const result = await res.json();
        console.log('[carregarRegistrosModal] Resposta da API:', result);

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
        const res = await fetch(downloadUrl, {
            headers: getAuthHeaders()
        });
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

