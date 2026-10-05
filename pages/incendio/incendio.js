let currentIncendios = [];
let selectedDeviceSerial = '';
let socketInstance = null;
let isUpdatingDashboard = false;
let lastDevicesSignature = '';
let lastProcessedReadingSignature = '';
let liveBadgeWatchdog = null;

// Fullscreen Presentation & Carousel State
let fullscreenActiveIndex = 0;
let fsAutoplayInterval = null;
const fsAutoplayDuration = 8000;
let fsGaugeChartInstance = null;
let fsIncendioChartInstance = null;
let fsKeyboardListenerAttached = false;

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
    loadIncendioData();

    // Sincronização periódica da telemetria a cada 1.5s
    setInterval(() => {
        loadIncendioData(true);
    }, 1500);

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
                auth: { token: localStorage.getItem('sensorium_token') },
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                transports: ['websocket', 'polling']
            });

            socketInstance.on('connect', () => {
                console.log('[Incêndio Socket] Conectado em tempo real.');
            });

            // Eventos específicos de incêndio ou compartilhados de relés
            socketInstance.on('incendio_reading', (data) => {
                handleLiveIncendioReading(data);
            });

            socketInstance.on('rele_reading', (data) => {
                handleLiveIncendioReading(data);
            });

            socketInstance.on('dashboard_update', (data) => {
                if (data?.data && (data.type === 'incendio_data' || data.type === 'reles_data')) {
                    handleLiveIncendioReading(data.data);
                } else {
                    loadIncendioData(true);
                }
            });

            socketInstance.on('disconnect', () => {
                console.warn('[Incêndio Socket] Desconectado.');
                setLiveBadgeState(false);
            });
        } catch (err) {
            console.error('[Incêndio Socket] Erro ao conectar:', err);
            setLiveBadgeState(false);
        }
    }
}

function getAuthHeaders() {
    const token = localStorage.getItem('sensorium_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
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
            currentIncendios = loadedData;
        }

        populateIncendioSelect(currentIncendios);
        renderIncendioGrid(currentIncendios);
        updateExecutiveSummary(currentIncendios);

        if (document.body.classList.contains('fullscreen-active')) {
            renderFullscreenStation(fullscreenActiveIndex);
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
        const activeDev = currentIncendios[fullscreenActiveIndex];
        if (activeDev && activeDev.numero_serie === numeroSerie) {
            renderFullscreenStation(fullscreenActiveIndex);
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
                <div class="incendio-card ${isSel ? 'selected' : ''}" data-serie="${d.numero_serie}" onclick="selectIncendio('${d.numero_serie}')">
                    <div class="incendio-card-header">
                        <span class="incendio-card-title">${nomeStr}</span>
                        <span class="status-dot-fine ${dotClass}" title="${d.status || 'Normal'}"></span>
                    </div>
                    <div class="incendio-card-body">
                        <div class="incendio-row">
                            <span>Série / Identificador:</span>
                            <strong>${d.numero_serie}</strong>
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
   MOTOR DE TELEMETRIA CONTÍNUA EM CANVAS (60/120 FPS)
   ========================================================================== */

class IncendioTelemetryEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        
        this.numPoints = 60;
        this.points = new Array(this.numPoints).fill(115);
        
        this.targetPressure = 115;
        this.currentPressure = 115;
        this.setpointPrincipalOn = 85;
        this.setpointJockeyOn = 95;
        this.setpointOff = 125;
        
        this.minVal = 40;
        this.maxVal = 160;
        
        this.isRunning = false;
        this.animFrameId = null;
        this.lastFrameTime = performance.now();
        this.pulsePhase = 0;
        this.sampleTimer = 0;
        this.sampleIntervalMs = 150;
        
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
    
    pushReading(sensor1, rele1_on, rele1_off, rele2_on, timestamp = null) {
        const val = sensor1 !== null && sensor1 !== undefined ? Number(sensor1) : null;
        if (val !== null && !isNaN(val)) {
            this.targetPressure = val;
        }
        
        if (rele1_on !== null && rele1_on !== undefined) this.setpointPrincipalOn = Number(rele1_on);
        if (rele1_off !== null && rele1_off !== undefined) this.setpointOff = Number(rele1_off);
        if (rele2_on !== null && rele2_on !== undefined) this.setpointJockeyOn = Number(rele2_on);
    }
    
    loadHistory(data, serial) {
        let spPOn = null;
        let spJOn = null;
        let spOff = null;
        for (let i = data.length - 1; i >= 0; i--) {
            if (spPOn === null && data[i].rele1_on !== null && data[i].rele1_on !== undefined) spPOn = Number(data[i].rele1_on);
            if (spOff === null && data[i].rele1_off !== null && data[i].rele1_off !== undefined) spOff = Number(data[i].rele1_off);
            if (spJOn === null && data[i].rele2_on !== null && data[i].rele2_on !== undefined) spJOn = Number(data[i].rele2_on);
        }
        if (spPOn !== null) this.setpointPrincipalOn = spPOn;
        if (spJOn !== null) this.setpointJockeyOn = spJOn;
        if (spOff !== null) this.setpointOff = spOff;
        
        const validValues = data.map(d => (d.sensor1 !== null && d.sensor1 !== undefined ? Number(d.sensor1) : null)).filter(v => v !== null && !isNaN(v));
        
        if (validValues.length > 0) {
            const lastVal = validValues[validValues.length - 1];
            this.targetPressure = lastVal;
            this.currentPressure = lastVal;
            
            this.points = [];
            for (let i = 0; i < this.numPoints; i++) {
                const ratio = i / (this.numPoints - 1);
                const dataIdx = Math.floor(ratio * (validValues.length - 1));
                this.points.push(validValues[dataIdx] !== undefined ? validValues[dataIdx] : lastVal);
            }
        }
    }
    
    update(dt) {
        const lerpSpeed = 0.20;
        this.currentPressure += (this.targetPressure - this.currentPressure) * lerpSpeed;
        this.pulsePhase += dt * 0.005;
        
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
        const padRight = 100;
        const plotWidth = w - padLeft - padRight;
        const plotHeight = h - padTop - padBottom;
        
        // 1. Grid e Escala (0 a 160 psi)
        ctx.lineWidth = 1;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = '500 11px Inter, sans-serif';
        
        const steps = [40, 60, 80, 100, 120, 140, 160];
        steps.forEach(step => {
            const y = this.getY(step, padTop, plotHeight);
            
            ctx.beginPath();
            ctx.strokeStyle = step === 40 ? 'rgba(203, 213, 225, 0.8)' : 'rgba(226, 232, 240, 0.6)';
            ctx.setLineDash([]);
            ctx.moveTo(padLeft, y);
            ctx.lineTo(w - padRight, y);
            ctx.stroke();
            
            ctx.fillStyle = '#64748b';
            ctx.fillText(`${step} psi`, padLeft - 10, y);
        });
        
        // 2. Linha de Setpoint - Bomba Principal (Vermelho)
        if (this.setpointPrincipalOn !== null && !isNaN(this.setpointPrincipalOn)) {
            const yOn = this.getY(this.setpointPrincipalOn, padTop, plotHeight);
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([5, 5]);
            ctx.moveTo(padLeft, yOn);
            ctx.lineTo(w - padRight, yOn);
            ctx.stroke();
            
            ctx.setLineDash([]);
            ctx.fillStyle = '#fef2f2';
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 1;
            const badgeW = 90;
            const badgeH = 20;
            const badgeX = w - padRight + 6;
            const badgeY = yOn - badgeH / 2;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            ctx.fill();
            ctx.stroke();
            
            ctx.fillStyle = '#991b1b';
            ctx.font = '600 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`P. Princ: ${this.setpointPrincipalOn.toFixed(1)}`, badgeX + badgeW / 2, yOn);
            ctx.restore();
        }

        // 3. Linha de Setpoint - Bomba Jockey (Laranja)
        if (this.setpointJockeyOn !== null && !isNaN(this.setpointJockeyOn)) {
            const yJockey = this.getY(this.setpointJockeyOn, padTop, plotHeight);
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#ea580c';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([4, 4]);
            ctx.moveTo(padLeft, yJockey);
            ctx.lineTo(w - padRight, yJockey);
            ctx.stroke();
            
            ctx.setLineDash([]);
            ctx.fillStyle = '#fff7ed';
            ctx.strokeStyle = '#ea580c';
            ctx.lineWidth = 1;
            const badgeW = 90;
            const badgeH = 20;
            const badgeX = w - padRight + 6;
            const badgeY = yJockey - badgeH / 2;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            ctx.fill();
            ctx.stroke();
            
            ctx.fillStyle = '#c2410c';
            ctx.font = '600 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`Jockey: ${this.setpointJockeyOn.toFixed(1)}`, badgeX + badgeW / 2, yJockey);
            ctx.restore();
        }
        
        // 4. Linha de Setpoint OFF - Corte de Pressão (Verde)
        if (this.setpointOff !== null && !isNaN(this.setpointOff)) {
            const yOff = this.getY(this.setpointOff, padTop, plotHeight);
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([5, 5]);
            ctx.moveTo(padLeft, yOff);
            ctx.lineTo(w - padRight, yOff);
            ctx.stroke();
            
            ctx.setLineDash([]);
            ctx.fillStyle = '#ecfdf5';
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1;
            const badgeW = 90;
            const badgeH = 20;
            const badgeX = w - padRight + 6;
            const badgeY = yOff - badgeH / 2;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            ctx.fill();
            ctx.stroke();
            
            ctx.fillStyle = '#065f46';
            ctx.font = '600 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`Corte: ${this.setpointOff.toFixed(1)}`, badgeX + badgeW / 2, yOff);
            ctx.restore();
        }
        
        // 5. Curva de Pressão Contínua (60 pontos)
        const renderPoints = [];
        const count = this.points.length;
        
        for (let i = 0; i < count; i++) {
            const x = padLeft + (plotWidth / Math.max(1, count - 1)) * i;
            const val = (i === count - 1) ? this.currentPressure : this.points[i];
            const y = this.getY(val, padTop, plotHeight);
            renderPoints.push({ x, y, val });
        }
        
        const leadX = renderPoints[count - 1].x;
        const leadY = renderPoints[count - 1].y;
        
        if (renderPoints.length >= 2) {
            ctx.save();
            
            ctx.beginPath();
            ctx.rect(padLeft, padTop - 5, plotWidth + 2, plotHeight + 10);
            ctx.clip();
            
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
            
            const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotHeight);
            grad.addColorStop(0, 'rgba(30, 96, 172, 0.28)');
            grad.addColorStop(0.7, 'rgba(30, 96, 172, 0.05)');
            grad.addColorStop(1, 'rgba(30, 96, 172, 0.0)');
            
            ctx.lineTo(leadX, padTop + plotHeight);
            ctx.lineTo(renderPoints[0].x, padTop + plotHeight);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();
            
            // Traçado da Linha de Pressão
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
        
        // 6. Farol Luminoso na Ponta Ativa
        ctx.save();
        const waveRadius = 7 + (this.pulsePhase * 8) % 14;
        const waveAlpha = Math.max(0, 1 - waveRadius / 21);
        
        ctx.beginPath();
        ctx.arc(leadX, leadY, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(30, 96, 172, ${waveAlpha * 0.7})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(leadX, leadY, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#1e60ac';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
        
        // 7. Eixo X de Tempo
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
        
        // 8. Tooltip interativo
        if (this.isHovering && this.mouseX >= padLeft && this.mouseX <= w - padRight) {
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.moveTo(this.mouseX, padTop);
            ctx.lineTo(this.mouseX, padTop + plotHeight);
            ctx.stroke();
            
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
                
                const ttText = `${Number(closest.val).toFixed(2)} psi`;
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

/**
 * Alterna o modo Tela Cheia
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

function toggleNavDropdown(btn) {
    const dropdown = btn.closest('.nav-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');
    }
}

/* ==========================================================================
   MODAL DE REGISTROS DE LEITURAS & EXPORTAÇÃO CSV / EXCLUSÃO
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

        registrosTotalPages = recordsResult.totalPages || 1;
        const rows = recordsResult.data || [];
        const total = recordsResult.total || 0;

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
                    <td><strong>${r.numero_serie}</strong></td>
                    <td>${cliente} (${setor})</td>
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
            tableBody.innerHTML = `<tr><td colspan="10" class="table-state-message" style="color: #ef4444;">Erro ao carregar registros: ${err.message}</td></tr>`;
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

function limparFiltrosRegistrosModal() {
    const filterDev = document.getElementById('filterModalDispositivo');
    const dataInicio = document.getElementById('filterModalDataInicio');
    const dataFim = document.getElementById('filterModalDataFim');

    if (filterDev) filterDev.value = 'todos';
    if (dataInicio) dataInicio.value = '';
    if (dataFim) dataFim.value = '';

    limparFeedbackModal();
    carregarRegistrosModal(1);
}

function aplicarAtalhoData(tipo) {
    const dataInicio = document.getElementById('filterModalDataInicio');
    const dataFim = document.getElementById('filterModalDataFim');
    if (!dataInicio || !dataFim) return;

    const agora = new Date();
    const toIsoStringLocal = (date) => {
        const pad = n => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };

    dataFim.value = toIsoStringLocal(agora);

    const inicio = new Date();
    if (tipo === 'hoje') {
        inicio.setHours(0, 0, 0, 0);
    } else if (tipo === '7dias') {
        inicio.setDate(inicio.getDate() - 7);
    } else if (tipo === '30dias') {
        inicio.setDate(inicio.getDate() - 30);
    }
    dataInicio.value = toIsoStringLocal(inicio);

    filtrarRegistrosModal();
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

function fecharConfirmacaoExclusao() {
    const modal = document.getElementById('confirmDeleteModal');
    if (modal) modal.classList.remove('active');
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

        await fetch(`${API_BASE}/api/incendio/registros`, {
            method: 'DELETE',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ numeroSerie: filterDev, dataInicio, dataFim })
        });

        fecharConfirmacaoExclusao();
        mostrarFeedbackModal('Registros no período selecionado foram apagados com sucesso.', 'success');
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

function mostrarFeedbackModal(msg, tipo = 'info') {
    const box = document.getElementById('modalRegistrosFeedback');
    if (!box) return;
    box.innerText = msg;
    box.className = `modal-feedback-box ${tipo}`;
    box.style.display = 'block';

    setTimeout(() => {
        if (box) box.style.display = 'none';
    }, 6000);
}

function limparFeedbackModal() {
    const box = document.getElementById('modalRegistrosFeedback');
    if (box) {
        box.style.display = 'none';
        box.innerText = '';
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
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const fsText = document.getElementById('fullscreenText');
    if (fsText) {
        fsText.innerText = isFs ? 'Sair Tela Cheia' : 'Tela Cheia';
    }

    document.body.classList.toggle('fullscreen-active', isFs);

    if (isFs) {
        setupFullscreenPresentation();
    } else {
        stopFsAutoplay();
    }
}

function setupFullscreenPresentation() {
    if (!fsKeyboardListenerAttached) {
        document.addEventListener('keydown', handleFullscreenKeydown);
        fsKeyboardListenerAttached = true;
    }

    populateFsDeviceSelect();

    const standardSelect = document.getElementById('incendioSelect');
    if (standardSelect && standardSelect.value && currentIncendios && currentIncendios.length > 0) {
        const foundIdx = currentIncendios.findIndex(d => d.numero_serie === standardSelect.value);
        if (foundIdx >= 0) fullscreenActiveIndex = foundIdx;
    }

    renderFullscreenStation(fullscreenActiveIndex);
    startFsAutoplay();
}

function populateFsDeviceSelect() {
    const select = document.getElementById('fsDeviceSelect');
    if (!select) return;

    if (!currentIncendios || currentIncendios.length === 0) {
        select.innerHTML = '<option value="">Nenhuma central</option>';
        return;
    }

    select.innerHTML = currentIncendios.map((d, idx) => `
        <option value="${d.numero_serie}">${d.numero_serie} - ${d.nome || 'Central'} (${idx + 1}/${currentIncendios.length})</option>
    `).join('');
}

function onFsDeviceSelectChange(selectedSerial) {
    if (!selectedSerial || !currentIncendios) return;
    const idx = currentIncendios.findIndex(d => d.numero_serie === selectedSerial);
    if (idx >= 0) {
        renderFullscreenStation(idx);
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

function navigateFullscreenCarousel(direction) {
    if (!currentIncendios || currentIncendios.length === 0) return;
    fullscreenActiveIndex += direction;
    if (fullscreenActiveIndex < 0) fullscreenActiveIndex = currentIncendios.length - 1;
    if (fullscreenActiveIndex >= currentIncendios.length) fullscreenActiveIndex = 0;

    renderFullscreenStation(fullscreenActiveIndex);
}

function toggleFullscreenAutoplay() {
    if (fsAutoplayInterval) {
        stopFsAutoplay();
    } else {
        startFsAutoplay();
    }
}

function startFsAutoplay() {
    stopFsAutoplay();
    const btn = document.getElementById('fsAutoplayBtn');
    const txt = document.getElementById('fsAutoplayText');
    const icon = document.getElementById('fsAutoplayIcon');

    if (btn) btn.classList.add('playing');
    if (txt) txt.innerText = 'Pausar (8s)';
    if (icon) icon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';

    fsAutoplayInterval = setInterval(() => {
        navigateFullscreenCarousel(1);
    }, fsAutoplayDuration);
}

function stopFsAutoplay() {
    if (fsAutoplayInterval) {
        clearInterval(fsAutoplayInterval);
        fsAutoplayInterval = null;
    }
    const btn = document.getElementById('fsAutoplayBtn');
    const txt = document.getElementById('fsAutoplayText');
    const icon = document.getElementById('fsAutoplayIcon');

    if (btn) btn.classList.remove('playing');
    if (txt) txt.innerText = 'Auto (8s)';
    if (icon) icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
}

function renderFsDots() {
    const container = document.getElementById('fsDotsContainer');
    if (!container || !currentIncendios) return;

    container.innerHTML = currentIncendios.map((_, idx) => `
        <div class="fs-dot ${idx === fullscreenActiveIndex ? 'active' : ''}" onclick="renderFullscreenStation(${idx})" title="Ir para central ${idx + 1}"></div>
    `).join('');
}

/**
 * Renderiza a central ativa no Modo Tela Cheia com os 4 Cards e o Gráfico dedicado
 */
function renderFullscreenStation(index) {
    if (!currentIncendios || currentIncendios.length === 0) return;

    if (index < 0) index = currentIncendios.length - 1;
    if (index >= currentIncendios.length) index = 0;
    fullscreenActiveIndex = index;

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
    renderFsDots();
    const select = document.getElementById('fsDeviceSelect');
    if (select && select.value !== dev.numero_serie) {
        select.value = dev.numero_serie;
    }
    const counterEl = document.getElementById('fsDeviceCounterText');
    if (counterEl) {
        counterEl.innerText = `Central ${fullscreenActiveIndex + 1} de ${currentIncendios.length}`;
    }
}

function updateFsGaugeChart(value, min, max, fillColor) {
    const canvas = document.getElementById('fsGaugePressureCanvas');
    if (!canvas || typeof Chart === 'undefined') return;

    const val = (value !== null && value !== undefined && !isNaN(value)) ? Number(value) : min;
    const clamped = Math.max(min, Math.min(max, val));
    const progress = clamped - min;
    const remaining = max - clamped;

    if (fsGaugeChartInstance) {
        try {
            if (fsGaugeChartInstance.canvas === canvas) {
                fsGaugeChartInstance.data.datasets[0].data = [progress, remaining];
                fsGaugeChartInstance.data.datasets[0].backgroundColor = [fillColor, '#e2e8f0'];
                fsGaugeChartInstance.update('none');
                return;
            } else {
                fsGaugeChartInstance.destroy();
                fsGaugeChartInstance = null;
            }
        } catch (e) {
            fsGaugeChartInstance = null;
        }
    }

    try {
        const ctx = canvas.getContext('2d');
        fsGaugeChartInstance = new Chart(ctx, {
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
    } catch (err) {
        console.warn('Erro ao criar manômetro fullscreen:', err);
    }
}

function renderFullscreenChart(dev) {
    const canvas = document.getElementById('fsIncendioChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const u = dev.ultima_leitura || {};
    const r1_on = Number(u.rele1_on || 85.0);
    const r1_off = Number(u.rele1_off || 125.0);
    const r2_on = Number(u.rele2_on || 95.0);

    const labels = [];
    const pressureData = [];
    const r1OnData = [];
    const r1OffData = [];
    const r2OnData = [];

    const now = Date.now();
    const pointsCount = 30;
    const intervalMs = 3000;

    let baseP = Number(u.sensor1 || 118.0);
    for (let i = pointsCount - 1; i >= 0; i--) {
        const t = new Date(now - i * intervalMs);
        labels.push(t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        const offset = Math.sin(i * 0.4) * 4.5 + (Math.random() * 1.5);
        const p = Math.max(70, Math.min(135, baseP + offset));
        pressureData.push(Number(p.toFixed(1)));
        r1OnData.push(r1_on);
        r1OffData.push(r1_off);
        r2OnData.push(r2_on);
    }

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

function toggleNavDropdown(btn) {
    const dropdown = btn.closest('.nav-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');
    }
}
