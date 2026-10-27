/**
 * ============================================================================
 * SENSIMONITOR - CLIENTE TEMPO REAL (SOCKET.IO) & SMART POLLING (CORE)
 * ============================================================================
 * Padroniza a inicialização de conexões WebSocket (Socket.IO) com autenticação
 * JWT e gerencia ciclos de polling que respeitam a visibilidade da página.
 */
(function (global) {
    'use strict';

    /**
     * Inicializa uma conexão Socket.IO padronizada
     * @param {Object} config
     * @param {string} [config.logPrefix='Socket.IO']
     * @param {Object<string, Function>} [config.events={}] Mapa de eventos (ex: { rele_reading: fn })
     * @param {Function} [config.onConnect]
     * @param {Function} [config.onDisconnect]
     * @param {Function} [config.onError]
     * @returns {Object|null} Instância do socket ou null se io não estiver carregado
     */
    function createRealtimeSocket(config = {}) {
        if (typeof global.io === 'undefined') {
            console.warn(`[${config.logPrefix || 'Socket.IO'}] Biblioteca Socket.IO não carregada.`);
            return null;
        }

        const logPrefix = config.logPrefix || config.moduleName || 'Socket.IO';
        try {
            const socketUrl =
                global.API_BASE ||
                (global.location.origin.includes(':') ? global.location.origin : 'http://localhost:3000');

            const socket = global.io(socketUrl, {
                auth: { token: localStorage.getItem('sensorium_token') },
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                transports: ['websocket', 'polling']
            });

            socket.on('connect', () => {
                console.log(`[${logPrefix}] Conectado em tempo real.`);
                if (typeof config.onConnect === 'function') config.onConnect(socket);
            });

            if (config.events && typeof config.events === 'object') {
                Object.entries(config.events).forEach(([eventName, handler]) => {
                    if (typeof handler === 'function') {
                        socket.on(eventName, handler);
                    }
                });
            }

            socket.on('disconnect', () => {
                console.warn(`[${logPrefix}] Desconectado.`);
                if (typeof config.onDisconnect === 'function') config.onDisconnect();
            });

            return socket;
        } catch (err) {
            console.error(`[${logPrefix}] Erro ao conectar:`, err);
            if (typeof config.onError === 'function') config.onError(err);
            return null;
        }
    }

    /**
     * Cria um timer de polling inteligente que evita chamadas sobrepostas quando a aba
     * está oculta (opcionalmente executando imediatamente ao voltar o foco).
     */
    function startSmartPolling(callback, intervalMs, pauseWhenHidden = true) {
        if (typeof callback !== 'function') return null;

        const timerId = setInterval(() => {
            if (pauseWhenHidden && document.hidden) return;
            callback(true);
        }, intervalMs);

        if (pauseWhenHidden) {
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) {
                    callback(true);
                }
            });
        }

        return timerId;
    }

    /** Instante de uma leitura em ms pelo timestamp ("AAAA-MM-DD HH:mm:ss" ou ISO). */
    function instante(l) {
        if (!l) return null;
        const ts = l.timestamp ?? l.timestamp_leitura;
        if (ts === null || ts === undefined || ts === '') return null;
        const t = Date.parse(String(ts).trim().replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T'));
        return isNaN(t) ? null : t;
    }

    const temId = (l) => !!l && l.leitura_id !== null && l.leitura_id !== undefined && l.leitura_id !== '' && !isNaN(Number(l.leitura_id));
    const ultimaLeituraSocket = new Map(); // numeroSerie -> chave da última leitura aceita

    /**
     * Filtro das leituras do socket. O backend envia cada leitura duas vezes
     * (evento do tipo + dashboard_update); só a repetição EXATA é descartada.
     * Leituras diferentes são sempre aceitas, na ordem em que chegam, mesmo
     * que o relógio do equipamento repita ou volte o horário.
     */
    function isNewerReading(nova, atual) {
        if (!nova) return false;
        const serie = nova.numeroSerie || nova.numero_serie;
        if (!serie) return true;
        const chave = temId(nova) ? `id:${Number(nova.leitura_id)}` : `sig:${JSON.stringify(nova)}`;
        if (ultimaLeituraSocket.get(serie) === chave) return false;
        ultimaLeituraSocket.set(serie, chave);
        return true;
    }

    /** true só quando a leitura da API é claramente MAIS ANTIGA que a exibida. */
    function apiMaisAntiga(api, atual) {
        if (!atual || !api) return false;
        if (temId(api) && temId(atual)) return Number(api.leitura_id) < Number(atual.leitura_id);
        const a = instante(api);
        const b = instante(atual);
        if (a === null || b === null) return false;
        return a < b;
    }

    /**
     * Junta a lista nova da API com a da tela: mantém a leitura da tela apenas se
     * a da API for mais antiga (resposta atrasada enquanto o socket já trouxe outra).
     */
    function mergeKeepingNewest(atuais, novos) {
        const porSerie = new Map((atuais || []).map((d) => [d.numero_serie, d]));
        return (novos || []).map((n) => {
            const a = porSerie.get(n.numero_serie);
            if (a && a.ultima_leitura && n.ultima_leitura && apiMaisAntiga(n.ultima_leitura, a.ultima_leitura)) {
                return { ...n, ultima_leitura: a.ultima_leitura, status: a.status ?? n.status };
            }
            return n;
        });
    }

    /**
     * Histórico real de leituras (rotas /api/<tipo>/:numeroSerie/leituras), em ordem
     * cronológica. Substitui os gráficos que eram preenchidos com números aleatórios.
     */
    async function loadHistory(path, maxPoints = 30, periodo = 'all') {
        try {
            const headers = typeof global.getAuthHeaders === 'function' ? global.getAuthHeaders() : {};
            const sep = path.includes('?') ? '&' : '?';
            const res = await fetch(`${global.API_BASE}${path}${sep}periodo=${encodeURIComponent(periodo)}`, { headers });
            if (!res.ok) return [];
            const r = await res.json();
            if (!r || !r.success || !Array.isArray(r.data)) return [];
            const rows = r.data.slice().reverse();
            return maxPoints && rows.length > maxPoints ? rows.slice(-maxPoints) : rows;
        } catch (e) {
            return [];
        }
    }

    /** Rótulo HH:MM:SS de uma leitura (aceita "AAAA-MM-DD HH:mm:ss" do banco). */
    function readingLabel(item) {
        const ts = item && (item.timestamp || item.timestamp_leitura || item.created_at);
        const d = ts ? new Date(String(ts).replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T')) : new Date();
        return (isNaN(d) ? new Date() : d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    global.SensoriumHistory = { load: loadHistory, label: readingLabel };

    global.SensoriumRealtime = {
        createRealtimeSocket,
        startSmartPolling,
        isNewerReading,
        mergeKeepingNewest
    };
})(window);
