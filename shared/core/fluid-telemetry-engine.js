/**
 * ============================================================================
 * SENSIMONITOR - MOTOR DE TELEMETRIA CONTÍNUA EM CANVAS (60/120 FPS)
 * ============================================================================
 * Renderiza curvas de pressão/telemetria de alta fluidez com interpolação
 * contínua (Catmull-Rom / Bezier), farol pulsante em tempo real, linhas de
 * setpoint (ON, OFF e Jockey opcional) e tooltip interativo.
 */
(function (global) {
    'use strict';

    class FluidTelemetryEngine {
        constructor(canvasId, options = {}) {
            this.canvasId = canvasId;
            this.canvas = document.getElementById(canvasId);
            if (this.canvas) {
                this.ctx = this.canvas.getContext('2d');
            }

            this.unit = options.unit || 'psi';
            this.numPoints = options.numPoints || 60;
            const initVal = options.initialValue !== undefined ? options.initialValue : 0;
            this.points = new Array(this.numPoints).fill(initVal);

            this.targetPressure = initVal;
            this.currentPressure = initVal;
            this.setpointOn = options.defaultSetpointOn !== undefined ? options.defaultSetpointOn : null;
            this.setpointOff = options.defaultSetpointOff !== undefined ? options.defaultSetpointOff : null;
            this.setpointJockeyOn = options.defaultSetpointJockeyOn !== undefined ? options.defaultSetpointJockeyOn : null;

            this.showJockey = Boolean(options.showJockey);
            this.minVal = options.minVal !== undefined ? options.minVal : 0;
            this.maxVal = options.maxVal !== undefined ? options.maxVal : 100;
            this.steps = options.steps || [0, 20, 40, 60, 80, 100];

            this.padRight = options.padRight || (this.showJockey ? 100 : 85);
            this.badgeWidth = options.badgeWidth || (this.showJockey ? 90 : 72);

            this.onLabel = options.onLabel || 'ON';
            this.offLabel = options.offLabel || 'OFF';
            this.jockeyLabel = options.jockeyLabel || 'Jockey';

            this.onStyle = options.onStyle || {
                stroke: '#10b981',
                fill: '#ecfdf5',
                text: '#059669'
            };
            this.offStyle = options.offStyle || {
                stroke: '#ef4444',
                fill: '#fef2f2',
                text: '#dc2626'
            };
            this.jockeyStyle = options.jockeyStyle || {
                stroke: '#ea580c',
                fill: '#fff7ed',
                text: '#c2410c'
            };

            this.isRunning = false;
            this.animFrameId = null;
            this.lastFrameTime = performance.now();
            this.pulsePhase = 0;
            this.sampleTimer = 0;
            this.sampleIntervalMs = options.sampleIntervalMs || 150;

            this.mouseX = -1;
            this.mouseY = -1;
            this.isHovering = false;

            this.setupCanvas();
            this.setupEvents();
            this.start();
        }

        setupCanvas() {
            if (!this.canvas) {
                this.canvas = document.getElementById(this.canvasId);
                if (!this.canvas) return;
                this.ctx = this.canvas.getContext('2d');
            }
            const rect = this.canvas.getBoundingClientRect();
            const dpr = global.devicePixelRatio || 1;
            const parentW = this.canvas.parentElement ? this.canvas.parentElement.clientWidth : 800;
            const parentH = this.canvas.parentElement ? this.canvas.parentElement.clientHeight : 340;
            this.width = rect.width > 0 ? rect.width : parentW || 800;
            this.height = rect.height > 0 ? rect.height : parentH || 340;
            this.canvas.width = this.width * dpr;
            this.canvas.height = this.height * dpr;
            if (this.ctx) {
                this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                this.ctx.scale(dpr, dpr);
            }
        }

        setupEvents() {
            if (!this.canvas) return;

            global.addEventListener('resize', () => {
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

        pushReading(sensor1, rele1_on, rele1_off, arg4 = null) {
            const val = sensor1 !== null && sensor1 !== undefined ? Number(sensor1) : null;
            if (val !== null && !isNaN(val)) {
                this.targetPressure = val;
                if (this.points.every(p => p === 0)) {
                    this.currentPressure = val;
                    this.points.fill(val);
                }
            }

            if (rele1_on !== null && rele1_on !== undefined) this.setpointOn = Number(rele1_on);
            if (rele1_off !== null && rele1_off !== undefined) this.setpointOff = Number(rele1_off);

            if (this.showJockey && arg4 !== null && arg4 !== undefined && !isNaN(Number(arg4))) {
                this.setpointJockeyOn = Number(arg4);
            }
        }

        loadHistory(data) {
            if (!Array.isArray(data)) return;

            let spOn = null;
            let spOff = null;
            let spJockey = null;

            for (let i = data.length - 1; i >= 0; i--) {
                if (spOn === null && data[i].rele1_on !== null && data[i].rele1_on !== undefined) {
                    spOn = Number(data[i].rele1_on);
                }
                if (spOff === null && data[i].rele1_off !== null && data[i].rele1_off !== undefined) {
                    spOff = Number(data[i].rele1_off);
                }
                if (spJockey === null && data[i].rele2_on !== null && data[i].rele2_on !== undefined) {
                    spJockey = Number(data[i].rele2_on);
                }
            }

            if (spOn !== null) this.setpointOn = spOn;
            if (spOff !== null) this.setpointOff = spOff;
            if (this.showJockey && spJockey !== null) this.setpointJockeyOn = spJockey;

            const validValues = data
                .map(d => (d.sensor1 !== null && d.sensor1 !== undefined ? Number(d.sensor1) : null))
                .filter(v => v !== null && !isNaN(v));

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

        drawSetpointLine(ctx, value, labelPrefix, style, padLeft, padRight, w, padTop, plotHeight, dash = [5, 5]) {
            if (value === null || value === undefined || isNaN(value)) return;
            const yPos = this.getY(value, padTop, plotHeight);
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = style.stroke;
            ctx.lineWidth = 1.8;
            ctx.setLineDash(dash);
            ctx.moveTo(padLeft, yPos);
            ctx.lineTo(w - padRight, yPos);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.fillStyle = style.fill;
            ctx.strokeStyle = style.stroke;
            ctx.lineWidth = 1;
            const badgeW = this.badgeWidth;
            const badgeH = 20;
            const badgeX = w - padRight + 6;
            const badgeY = yPos - badgeH / 2;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = style.text;
            ctx.font = this.showJockey ? '600 10px Inter, sans-serif' : '600 10.5px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${labelPrefix}: ${ value.toFixed(1) }`, badgeX + badgeW / 2, yPos);
            ctx.restore();
        }

        render() {
            const ctx = this.ctx;
            const w = this.width;
            const h = this.height;
            if (!ctx || w <= 0 || h <= 0) return;

            ctx.clearRect(0, 0, w, h);

            const padTop = 22;
            const padBottom = 32;
            const padLeft = 60;
            const padRight = this.padRight;
            const plotWidth = w - padLeft - padRight;
            const plotHeight = h - padTop - padBottom;

            // 1. Grid e Escala
            ctx.lineWidth = 1;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.font = '500 11px Inter, sans-serif';

            this.steps.forEach((step, idx) => {
                const y = this.getY(step, padTop, plotHeight);

                ctx.beginPath();
                ctx.strokeStyle = idx === 0 ? 'rgba(203, 213, 225, 0.8)' : 'rgba(226, 232, 240, 0.6)';
                ctx.setLineDash([]);
                ctx.moveTo(padLeft, y);
                ctx.lineTo(w - padRight, y);
                ctx.stroke();

                ctx.fillStyle = '#64748b';
                ctx.fillText(`${step} ${this.unit}`, padLeft - 10, y);
            });

            // 2. Linhas de Setpoint
            this.drawSetpointLine(ctx, this.setpointOn, this.onLabel, this.onStyle, padLeft, padRight, w, padTop, plotHeight, [5, 5]);
            if (this.showJockey) {
                this.drawSetpointLine(ctx, this.setpointJockeyOn, this.jockeyLabel, this.jockeyStyle, padLeft, padRight, w, padTop, plotHeight, [4, 4]);
            }
            this.drawSetpointLine(ctx, this.setpointOff, this.offLabel, this.offStyle, padLeft, padRight, w, padTop, plotHeight, [5, 5]);

            // 3. Curva de Pressão Contínua
            const renderPoints = [];
            const count = this.points.length;

            for (let i = 0; i < count; i++) {
                const x = padLeft + (plotWidth / Math.max(1, count - 1)) * i;
                const val = i === count - 1 ? this.currentPressure : this.points[i];
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

            // 4. Farol Luminoso na Ponta Ativa
            ctx.save();
            const waveRadius = 7 + ((this.pulsePhase * 8) % 14);
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

            // 5. Eixo X de Tempo
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

            // 6. Tooltip interativo
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

                    const ttText = `${Number(closest.val).toFixed(2)} ${this.unit}`;
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

    /**
     * Especialização pré-configurada para Rede de Combate a Incêndio (Bomba Principal + Jockey + Corte)
     */
    class IncendioTelemetryEngine extends FluidTelemetryEngine {
        constructor(canvasId, options = {}) {
            super(canvasId, {
                unit: 'psi',
                initialValue: 115,
                defaultSetpointOn: 85,
                defaultSetpointJockeyOn: 95,
                defaultSetpointOff: 125,
                showJockey: true,
                minVal: 40,
                maxVal: 160,
                steps: [40, 60, 80, 100, 120, 140, 160],
                padRight: 100,
                badgeWidth: 90,
                onLabel: 'P. Princ',
                jockeyLabel: 'Jockey',
                offLabel: 'Corte',
                onStyle: { stroke: '#dc2626', fill: '#fef2f2', text: '#991b1b' },
                jockeyStyle: { stroke: '#ea580c', fill: '#fff7ed', text: '#c2410c' },
                offStyle: { stroke: '#10b981', fill: '#ecfdf5', text: '#065f46' },
                ...options
            });
        }
    }

    global.FluidTelemetryEngine = FluidTelemetryEngine;
    global.IncendioTelemetryEngine = IncendioTelemetryEngine;
})(window);
