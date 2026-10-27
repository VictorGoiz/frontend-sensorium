/**
 * ============================================================================
 * SENSIMONITOR - DADOS SIMULADOS E SIMULADOR DE CICLO HPU (HIDRÁULICO MOCK)
 * ============================================================================
 * Fornece unidades hidráulicas de demonstração e simulação de ciclo de carga,
 * alívio e recirculação quando a API de backend não retorna dispositivos reais.
 */
(function (global) {
    'use strict';

    const SIMULATED_HIDRAULICO_DEVICES = [
        {
            numero_serie: 'HPU-01',
            nome: 'Prensa Hidráulica Estampagem 500T',
            cliente: 'Planta Metalúrgica Automotiva',
            status: 'Operacional',
            isSimulated: true,
            ultima_leitura: {
                sensor1: 158.5,
                rele1_on: 130.0,
                rele1_off: 180.0,
                rele1_acionamentos: 342,
                rele1_estado: 0,
                rele2_on: 115.0,
                rele2_off: 180.0,
                rele2_acionamentos: 88,
                rele2_estado: 0,
                timestamp: new Date().toISOString()
            }
        },
        {
            numero_serie: 'HPU-02',
            nome: 'Central Hidráulica Injetora 02',
            cliente: 'Fundição & Usinagem de Precisão',
            status: 'Operacional',
            isSimulated: true,
            ultima_leitura: {
                sensor1: 142.0,
                rele1_on: 125.0,
                rele1_off: 175.0,
                rele1_acionamentos: 215,
                rele1_estado: 0,
                rele2_on: 110.0,
                rele2_off: 175.0,
                rele2_acionamentos: 45,
                rele2_estado: 0,
                timestamp: new Date().toISOString()
            }
        },
        {
            numero_serie: 'HPU-03',
            nome: 'Sistema Hidropneumático - Laminador',
            cliente: 'Siderurgia Nacional',
            status: 'Operacional',
            isSimulated: true,
            ultima_leitura: {
                sensor1: 165.0,
                rele1_on: 140.0,
                rele1_off: 190.0,
                rele1_acionamentos: 510,
                rele1_estado: 0,
                rele2_on: 120.0,
                rele2_off: 190.0,
                rele2_acionamentos: 112,
                rele2_estado: 0,
                timestamp: new Date().toISOString()
            }
        }
    ];

    /**
     * Executa um passo de simulação in-place nos dispositivos HPU simulados
     * @param {Array} devices Lista de dispositivos atual
     * @returns {boolean} true se ao menos um dispositivo simulado foi atualizado
     */
    function stepHidraulicoSimulation(devices) {
        if (!Array.isArray(devices) || devices.length === 0) return false;
        let hasSimulated = false;

        devices.forEach((dev) => {
            if (dev.isSimulated) {
                hasSimulated = true;
                if (!dev.ultima_leitura) {
                    dev.ultima_leitura = {
                        sensor1: 155.0,
                        rele1_on: 130.0,
                        rele1_off: 180.0,
                        rele1_acionamentos: 300,
                        rele1_estado: 0,
                        rele2_on: 115.0,
                        rele2_off: 180.0,
                        rele2_acionamentos: 75,
                        rele2_estado: 0,
                        timestamp: new Date().toISOString()
                    };
                }

                const l = dev.ultima_leitura;
                const r1_on = Number(l.rele1_on || 130.0);
                const r1_off = Number(l.rele1_off || 180.0);
                const r2_on = Number(l.rele2_on || 115.0);

                let currentP = Number(l.sensor1);
                let b1 = l.rele1_estado || 0;
                let b2 = l.rele2_estado || 0;

                if (b1 === 1 || b2 === 1) {
                    currentP += 4.5 + Math.random() * 1.2;
                    if (currentP >= r1_off) {
                        currentP = r1_off;
                        b1 = 0;
                        b2 = 0;
                    }
                } else {
                    currentP -= 1.8 + Math.random() * 0.8;
                    if (currentP <= r2_on) {
                        b1 = 1;
                        b2 = 1;
                        l.rele1_acionamentos = (l.rele1_acionamentos || 0) + 1;
                        l.rele2_acionamentos = (l.rele2_acionamentos || 0) + 1;
                    } else if (currentP <= r1_on) {
                        b1 = 1;
                        l.rele1_acionamentos = (l.rele1_acionamentos || 0) + 1;
                    }
                }

                l.sensor1 = Number(currentP.toFixed(1));
                l.rele1_estado = b1;
                l.rele2_estado = b2;
                l.timestamp = new Date().toISOString();

                if (currentP < 70.0) {
                    dev.status = 'Crítico';
                } else if (currentP > 210.0) {
                    dev.status = 'Atenção';
                } else {
                    dev.status = 'Operacional';
                }
            }
        });

        return hasSimulated;
    }

    global.SIMULATED_HIDRAULICO_DEVICES = SIMULATED_HIDRAULICO_DEVICES;
    global.stepHidraulicoSimulation = stepHidraulicoSimulation;
})(window);
